import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenAI } from '@google/genai';
import { pipeline, env } from '@xenova/transformers';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { QAEntry, QAStatus } from 'src/entities/qa-entry.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TranscriptData } from 'src/entities/transcript-entry.entity';
import * as fs from 'fs';
import * as path from 'path';

// Configure transformers.js
env.allowRemoteModels = true;
env.allowLocalModels = true;

interface SearchResult {
  content: string;
  score: number;
  startTime: string;
  endTime: string;
  chunkId: string;
  speaker: string;
  segmentCount: number;
}

interface RAGAnswer {
  answer: string;
  sources: string[];
  // relevantChunks: SearchResult[];
}

@Injectable()
export class RAGService implements OnModuleInit {
  private readonly logger = new Logger(RAGService.name);
  private qdrantClient: QdrantClient;
  private genAI: GoogleGenAI;
  private embeddingPipeline: any;
  private readonly collectionName = 'meeting_transcripts';
  private readonly embeddingModel = 'Xenova/all-MiniLM-L6-v2';
  private isEmbeddingModelLoaded = false;
  private modelLoadingPromise: Promise<void> | null = null;

  constructor(
    @InjectRepository(QAEntry)
    private readonly qaEntriesRepository: Repository<QAEntry>,
  ) {
    this.qdrantClient = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });

    this.genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  async onModuleInit() {
    // DON'T load model on startup - load it when needed
    this.logger.log('RAGService initialized - model will load on first use');
    await this.initializeCollection();
  }

  private logMemoryUsage(label: string) {
    const used = process.memoryUsage();
    this.logger.log(
      `[MEMORY-${label}] Heap Used: ${Math.round(used.heapUsed / 1024 / 1024)}MB / ${Math.round(used.heapTotal / 1024 / 1024)}MB`,
    );
    this.logger.log(
      `[MEMORY-${label}] RSS: ${Math.round(used.rss / 1024 / 1024)}MB`,
    );
    this.logger.log(
      `[MEMORY-${label}] External: ${Math.round(used.external / 1024 / 1024)}MB`,
    );
  }

  private async ensureModelLoaded(): Promise<void> {
    if (this.isEmbeddingModelLoaded) {
      return; // Already loaded
    }

    // Prevent multiple simultaneous loads
    if (this.modelLoadingPromise) {
      this.logger.log('Model already loading, waiting...');
      return this.modelLoadingPromise;
    }

    this.modelLoadingPromise = this.initializeEmbeddingModel();
    await this.modelLoadingPromise;
    this.modelLoadingPromise = null;
  }

  private async initializeEmbeddingModel() {
    try {
      this.logger.log('Loading local embedding model (on-demand)...');
      this.logMemoryUsage('BEFORE_MODEL_LOAD');

      this.embeddingPipeline = await pipeline(
        'feature-extraction',
        this.embeddingModel,
        {
          quantized: true,
          progress_callback: (progress) => {
            if (progress.status === 'downloading') {
              this.logger.log(
                `Downloading model: ${Math.round((progress.loaded / progress.total) * 100)}%`,
              );
            }
          },
        },
      );

      this.isEmbeddingModelLoaded = true;
      this.logger.log('Local embedding model initialized successfully');
      this.logMemoryUsage('AFTER_MODEL_LOAD');
    } catch (error) {
      this.logger.error('Error initializing embedding model:', error);
      this.isEmbeddingModelLoaded = false;
      this.modelLoadingPromise = null;
      throw new Error('Failed to initialize local embedding model');
    }
  }

  private async initializeCollection() {
    try {
      const collections = await this.qdrantClient.getCollections();
      const collectionExists = collections.collections.some(
        (col) => col.name === this.collectionName,
      );

      if (!collectionExists) {
        await this.qdrantClient.createCollection(this.collectionName, {
          vectors: {
            size: 384,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });
        this.logger.log(`Created Qdrant collection: ${this.collectionName}`);
        await this.createIndexes();
      } else {
        this.logger.log(
          `Qdrant collection already exists: ${this.collectionName}`,
        );
        await this.createIndexes();
      }
    } catch (error) {
      if (error.status === 409) {
        this.logger.log('Collection already exists, continuing...');
        await this.createIndexes();
        return;
      }
      this.logger.error('Error initializing Qdrant collection:', error);
    }
  }

  private async createIndexes() {
    try {
      await this.qdrantClient.createPayloadIndex(this.collectionName, {
        field_name: 'meetingId',
        field_schema: 'integer',
      });

      await this.qdrantClient.createPayloadIndex(this.collectionName, {
        field_name: 'speaker',
        field_schema: 'keyword',
      });

      await this.qdrantClient.createPayloadIndex(this.collectionName, {
        field_name: 'timestamp',
        field_schema: 'integer',
      });

      this.logger.log('Created indexes successfully');
    } catch (error) {
      if (error.status !== 409) {
        this.logger.error('Error creating indexes:', error);
      }
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Ensure model is loaded before using it
    await this.ensureModelLoaded();

    try {
      const output = await this.embeddingPipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      const embedding = Array.from(output.data) as number[];

      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding generated');
      }

      return embedding;
    } catch (error) {
      this.logger.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Ensure model is loaded before processing batch
    await this.ensureModelLoaded();

    const embeddings: number[][] = [];

    this.logger.log(`Generating embeddings for ${texts.length} texts...`);

    // Process one at a time to minimize memory
    for (let i = 0; i < texts.length; i++) {
      const embedding = await this.generateEmbedding(texts[i]);
      embeddings.push(embedding);

      if ((i + 1) % 10 === 0) {
        this.logger.log(`Generated embeddings: ${i + 1}/${texts.length}`);
      }
    }

    return embeddings;
  }

  private createContentHash(content: string, timestamp: number): string {
    const hashInput = `${content.trim()}_${timestamp}`;
    return createHash('md5').update(hashInput).digest('hex');
  }

  /**
   * Chunk transcripts to maintain context
   * Combines consecutive segments from the same speaker within a time window
   */
  public chunkTranscriptsForContext(transcripts: TranscriptData[]): Array<{
    transcript: string;
    speaker: string;
    speakerName: string;
    timestamp: number;
    segmentCount: number;
  }> {
    if (transcripts.length === 0) return [];

    const chunks: Array<{
      transcript: string;
      speaker: string;
      speakerName: string;
      timestamp: number;
      segmentCount: number;
    }> = [];

    let currentChunk = {
      transcript: transcripts[0].transcription.transcript,
      speaker: transcripts[0].speaker_uuid,
      speakerName: transcripts[0].speaker_name,
      timestamp: transcripts[0].timestamp_ms,
      segmentCount: 1,
    };

    for (let i = 1; i < transcripts.length; i++) {
      const current = transcripts[i];
      const timeDiff = currentChunk.timestamp - current.timestamp_ms;

      // Merge if same speaker and within 30 seconds
      const shouldMerge =
        current.speaker_uuid === currentChunk.speaker && timeDiff < 60000; // 30 seconds

      if (shouldMerge) {
        // Merge into current chunk
        currentChunk.transcript += ' ' + current.transcription.transcript;
        currentChunk.timestamp = current.timestamp_ms;
        currentChunk.segmentCount++;
      } else {
        // Save current chunk and start new one
        chunks.push({ ...currentChunk });
        currentChunk = {
          transcript: current.transcription.transcript,
          speaker: current.speaker_uuid,
          speakerName: current.speaker_name,
          timestamp: current.timestamp_ms,
          segmentCount: 1,
        };
      }
    }

    // Add the last chunk
    chunks.push(currentChunk);

    this.logger.log(
      `Chunked ${transcripts.length} transcripts into ${chunks.length} context-aware chunks`,
    );

    return chunks;
  }

  async storeTranscripts(
    meetingId: number,
    transcripts: TranscriptData[],
  ): Promise<void> {
    if (transcripts.length === 0) {
      this.logger.log('No transcripts to store');
      return;
    }

    try {
      this.logger.log(
        `[VECTOR-STORAGE] Processing ${transcripts.length} transcripts for meeting ${meetingId}`,
      );
      this.logMemoryUsage('STORE_START');

      // Chunk transcripts to maintain context
      const chunks = this.chunkTranscriptsForContext(transcripts);

      this.logger.log(
        `[VECTOR-STORAGE] Created ${chunks.length} context-aware chunks from ${transcripts.length} segments`,
      );

      // Process in small batches to avoid OOM
      const BATCH_SIZE = 10; // Only 10 chunks at a time
      let totalProcessed = 0;

      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);

        this.logger.log(
          `[BATCH] Processing chunks ${i + 1}-${Math.min(i + BATCH_SIZE, chunks.length)} of ${chunks.length}`,
        );

        // Create content texts for this batch only
        const contentTexts = batchChunks.map(
          (chunk) => `${chunk.speakerName}: ${chunk.transcript}`,
        );

        // Generate embeddings for this batch only
        const embeddings = await this.generateEmbeddings(contentTexts);

        // Create points for this batch only
        const points: Array<{
          id: string;
          vector: number[];
          payload: {
            meetingId: number;
            chunkId: string;
            transcript: string;
            speaker: string;
            speakerName: string;
            text: string;
            timestamp: number;
            segmentCount: number;
            contentHash: string;
          };
        }> = [];

        for (let j = 0; j < batchChunks.length; j++) {
          const chunk = batchChunks[j];
          const content = contentTexts[j];

          if (!embeddings[j] || embeddings[j].length !== 384) {
            this.logger.error(`Invalid embedding at index ${j}`);
            continue;
          }

          const contentHash = this.createContentHash(content, chunk.timestamp);

          points.push({
            id: contentHash,
            vector: embeddings[j],
            payload: {
              meetingId,
              chunkId: uuidv4(),
              text: chunk.transcript,
              speaker: chunk.speaker,
              speakerName: chunk.speakerName,
              transcript: chunk.transcript,
              segmentCount: chunk.segmentCount,
              timestamp: chunk.timestamp,
              contentHash,
            },
          });
        }

        // Upsert this batch
        if (points.length > 0) {
          await this.qdrantClient.upsert(this.collectionName, {
            wait: true,
            points,
          });
          totalProcessed += points.length;
        }

        // Clear batch from memory
        contentTexts.length = 0;
        embeddings.length = 0;
        points.length = 0;

        // Force GC if available
        if (global.gc) {
          global.gc();
        }

        this.logger.log(
          `[BATCH] Completed. Total processed: ${totalProcessed}/${chunks.length}`,
        );

        if ((i / BATCH_SIZE + 1) % 5 === 0) {
          this.logMemoryUsage(`BATCH_${i / BATCH_SIZE + 1}`);
        }
      }

      this.logger.log(
        `[VECTOR-STORAGE] Successfully stored ${totalProcessed} chunks for meeting ${meetingId}`,
      );
      this.logMemoryUsage('STORE_COMPLETE');
    } catch (error) {
      this.logger.error('Error storing transcripts:', error);
      this.logMemoryUsage('STORE_ERROR');
      throw error;
    }
  }

  async searchSimilarContent(
    meetingId: number,
    question: string,
    limit: number = 10,
  ): Promise<
    Array<{
      content: string;
      speaker: string;
      speakerName: string;
      timestamp: number;
      score: number;
    }>
  > {
    try {
      this.logger.log(
        `Searching for similar content in meeting ${meetingId}: "${question}"`,
      );

      // Generate embedding for the question
      const questionEmbedding = await this.generateEmbedding(question);

      // Search Qdrant with filters
      const searchResults = await this.qdrantClient.search(
        this.collectionName,
        {
          vector: questionEmbedding,
          limit: limit,
          filter: {
            must: [
              {
                key: 'meetingId',
                match: { value: meetingId },
              },
            ],
          },
          with_payload: true,
        },
      );

      // Transform results
      const results = searchResults.map((result) => ({
        content: result.payload?.content as string,
        speaker: result.payload?.speaker as string,
        speakerName: result.payload?.speakerName as string,
        timestamp: result.payload?.timestamp as number,
        score: result.score,
      }));

      this.logger.log(`Found ${results.length} similar chunks`);
      return results;
    } catch (error) {
      this.logger.error('Error searching similar content:', error);
      throw new Error('Failed to search relevant data.');
    }
  }

  async generateAnswer(
    question: string,
    searchResults: Array<{
      content: string;
      speaker: string;
      speakerName: string;
      timestamp: number;
      score: number;
    }>,
  ): Promise<{
    answer: string;
    sources: string[];
  }> {
    try {
      // Format context from search results
      const context = searchResults
        .map((result, idx) => {
          const time = new Date(result.timestamp).toLocaleTimeString();
          return `[${idx + 1}] ${result.speakerName} (${time}): ${result.content}`;
        })
        .join('\n\n');

      // Load QA prompt template
      const promptPath = path.join(__dirname, 'prompts', 'qa_prompt.txt');
      const qaPrompt = fs.readFileSync(promptPath, 'utf-8');

      const prompt = qaPrompt
        .replace('{{context}}', context)
        .replace('{{question}}', question);

      // Call Gemini API
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: prompt,
      });

      const answer = result.text || 'Unable to generate answer.';

      // Create source citations (first 100 chars of each result)
      const sources = searchResults.map(
        (r) =>
          r.content.substring(0, 100) + (r.content.length > 100 ? '...' : ''),
      );

      this.logger.log(
        `Generated answer for question: ${question.substring(0, 50)}...`,
      );

      return {
        answer: answer.trim(),
        sources,
      };
    } catch (error) {
      this.logger.error('Error generating answer:', error);
      throw new Error('Failed to generate answer with Gemini API');
    }
  }

  async askQuestion(
    meetingId: number,
    userId: string,
    question: string,
  ): Promise<QAEntry> {
    try {
      this.logger.log(
        `Processing question for meeting ${meetingId}: ${question}`,
      );

      // Search for relevant context
      const searchResults = await this.searchSimilarContent(
        meetingId,
        question,
        10,
      );

      if (searchResults.length === 0) {
        // No vectors found - provide helpful message
        const noDataMessage =
          "I couldn't find any relevant transcript data to answer your question. ";

        const qaEntry = this.qaEntriesRepository.create({
          userId: userId,
          meetingId: meetingId,
          question: question,
          answer: noDataMessage,
          status: QAStatus.ANSWERED,
          sources: [],
        });

        return await this.qaEntriesRepository.save(qaEntry);
      }

      // Generate answer using AI
      const { answer, sources } = await this.generateAnswer(
        question,
        searchResults,
      );

      // Save to database
      const qaEntry = this.qaEntriesRepository.create({
        userId: userId,
        meetingId: meetingId,
        question: question,
        answer: answer,
        status: QAStatus.ANSWERED,
        sources: sources,
      });

      return await this.qaEntriesRepository.save(qaEntry);
    } catch (error) {
      this.logger.error('Error processing question:', error);

      // Save failed attempt to database with user-friendly error message
      let errorMessage = 'An error occurred while processing your question.';

      if (error.message?.includes('vector database')) {
        errorMessage =
          'Unable to search transcript data. Please try again in a moment.';
      } else if (error.message?.includes('Gemini')) {
        errorMessage = 'Unable to generate answer. Please try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      const qaEntry = this.qaEntriesRepository.create({
        userId: userId,
        meetingId: meetingId,
        question: question,
        answer: errorMessage,
        status: QAStatus.ERROR,
        sources: [],
      });

      await this.qaEntriesRepository.save(qaEntry);
      throw error;
    }
  }
}

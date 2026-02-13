import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { AI_MODEL, VECTOR_DATABASE } from 'src/common/interfaces';
import type { IAIModel, IVectorDatabase } from 'src/common/interfaces';
import { v4 as uuidv4 } from 'uuid';
import { QAEntry, QAStatus } from 'src/entities/qa-entry.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TranscriptData } from 'src/entities/transcript-entry.entity';
import * as fs from 'fs/promises';
import * as path from 'path';
import Piscina from 'piscina';
import { EMBEDDING_WORKER_POOL } from 'src/workers/worker-pool.module';

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
}

interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  embeddings?: number[][];
  error?: string;
}

@Injectable()
export class RAGService implements OnModuleInit {
  private readonly logger = new Logger(RAGService.name);
  private readonly collectionName = 'meeting_transcripts';

  // Prompt cache - loaded once at startup
  private promptCache: Map<string, string> = new Map();

  constructor(
    @InjectRepository(QAEntry)
    private readonly qaEntriesRepository: Repository<QAEntry>,
    @Inject(EMBEDDING_WORKER_POOL)
    private readonly embeddingWorkerPool: Piscina,
    @Inject(AI_MODEL)
    private readonly aiModel: IAIModel,
    @Inject(VECTOR_DATABASE)
    private readonly vectorDB: IVectorDatabase,
  ) {}

  async onModuleInit() {
    await this.loadPromptCache();
    await this.initializeCollection();
    // Temp:
    await this.warmupWorkerPool();
  }

  /**
   * Load all prompt templates into memory at startup
   */
  private async loadPromptCache(): Promise<void> {
    try {
      const promptsDir = path.join(__dirname, 'prompts');

      // Load QA prompt
      const qaPromptPath = path.join(promptsDir, 'qa_prompt.txt');
      const qaPrompt = await fs.readFile(qaPromptPath, 'utf-8');
      this.promptCache.set('qa', qaPrompt);

      this.logger.log('Prompt templates loaded into cache');
    } catch (error) {
      this.logger.error('Error loading prompt cache:', error);
      throw new Error('Failed to load prompt templates');
    }
  }

  // Temp:
  /**
   * Warmup worker pool by sending a test embedding request
   * This ensures the model is loaded before real requests arrive
   */
  private async warmupWorkerPool(): Promise<void> {
    try {
      this.logger.log('Warming up embedding worker pool...');

      const result: EmbeddingResult = await this.embeddingWorkerPool.run({
        type: 'single',
        text: 'warmup test',
      });

      if (result.success) {
        this.logger.log('Embedding worker pool warmed up and ready');
      } else {
        throw new Error(result.error || 'Warmup failed');
      }
    } catch (error) {
      this.logger.error('Error warming up worker pool:', error);
      // Don't throw - allow startup to continue, pool will initialize on first request
    }
  }

  private async initializeCollection() {
    try {
      await this.vectorDB.initializeCollection(this.collectionName, 384, {
        optimizerConfig: { default_segment_number: 2 },
        replicationFactor: 1,
      });
      await this.createIndexes();
    } catch (error) {
      this.logger.error('Error initializing collection:', error);
    }
  }

  private async createIndexes() {
    await this.vectorDB.createIndex(this.collectionName, {
      fieldName: 'meetingId',
      fieldType: 'integer',
    });
    await this.vectorDB.createIndex(this.collectionName, {
      fieldName: 'speaker',
      fieldType: 'keyword',
    });
    await this.vectorDB.createIndex(this.collectionName, {
      fieldName: 'timestamp',
      fieldType: 'integer',
    });
    this.logger.log('Created indexes successfully');
  }

  /**
   * Generate embedding using worker thread pool
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result: EmbeddingResult = await this.embeddingWorkerPool.run({
        type: 'single',
        text,
      });

      if (!result.success || !result.embedding) {
        throw new Error(result.error || 'Failed to generate embedding');
      }

      return result.embedding;
    } catch (error: any) {
      this.logger.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const batchSize = 10;

    this.logger.log(
      `Generating embeddings for ${texts.length} texts using worker pool...`,
    );

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // Send batch to worker pool
      const result: EmbeddingResult = await this.embeddingWorkerPool.run({
        type: 'batch',
        texts: batch,
      });

      if (!result.success || !result.embeddings) {
        throw new Error(result.error || 'Failed to generate batch embeddings');
      }

      embeddings.push(...result.embeddings);

      const processed = Math.min(i + batchSize, texts.length);
      this.logger.log(`Generated embeddings: ${processed}/${texts.length}`);
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

      // Merge if same speaker and within 60 seconds
      const shouldMerge =
        current.speaker_uuid === currentChunk.speaker && timeDiff < 60000;

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

      // Chunk transcripts to maintain context
      const chunks = this.chunkTranscriptsForContext(transcripts);

      this.logger.log(
        `[VECTOR-STORAGE] Created ${chunks.length} context-aware chunks from ${transcripts.length} segments`,
      );

      // Create content texts for embeddings
      const contentTexts = chunks.map(
        (chunk) => `${chunk.speakerName}: ${chunk.transcript}`,
      );

      // Generate embeddings for chunks
      const embeddings = await this.generateEmbeddings(contentTexts);

      // Create points for storage
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

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const content = contentTexts[i];

        if (
          !embeddings[i] ||
          !Array.isArray(embeddings[i]) ||
          embeddings[i].length !== 384
        ) {
          this.logger.error(`Invalid embedding at index ${i}`);
          continue;
        }

        // Use startTime for hash to ensure uniqueness per chunk
        const contentHash = this.createContentHash(content, chunk.timestamp);

        const point = {
          id: contentHash,
          vector: embeddings[i],
          payload: {
            meetingId,
            chunkId: uuidv4(),
            content,
            speaker: chunk.speaker,
            speakerName: chunk.speakerName,
            text: chunk.transcript,
            transcript: chunk.transcript,
            segmentCount: chunk.segmentCount,
            timestamp: chunk.timestamp,
            contentHash,
          },
        };

        points.push(point);
      }

      if (points.length === 0) {
        this.logger.error('No valid points to upsert');
        return;
      }

      await this.vectorDB.upsert(this.collectionName, points);

      this.logger.log(
        `[VECTOR-STORAGE] Successfully stored ${points.length} context-aware chunks for meeting ${meetingId}`,
      );
      this.logger.log(
        `[VECTOR-STORAGE] Average segments per chunk: ${(transcripts.length / chunks.length).toFixed(1)}`,
      );
    } catch (error) {
      this.logger.error('Error storing transcripts:', error);
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

      // Search vector DB with filters
      const searchResults = await this.vectorDB.search(
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
          withPayload: true,
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

      // Get QA prompt from cache
      const qaPrompt = this.promptCache.get('qa');
      if (!qaPrompt) {
        throw new Error('QA prompt template not loaded');
      }

      const prompt = qaPrompt
        .replace('{{context}}', context)
        .replace('{{question}}', question);

      const result = await this.aiModel.generateContent(prompt);
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
    } catch (error: any) {
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

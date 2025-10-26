import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenAI } from '@google/genai';
import { pipeline, env } from '@xenova/transformers';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

// Configure transformers.js
env.allowRemoteModels = true;
env.allowLocalModels = true;

interface TranscriptData {
  speakerEmail: string;
  speakerName: string;
  text: string;
  timestamp: string;
}

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
    await this.initializeEmbeddingModel();
    await this.initializeCollection();
  }

  private async initializeEmbeddingModel() {
    try {
      this.logger.log('Loading local embedding model...');
      this.embeddingPipeline = await pipeline(
        'feature-extraction',
        this.embeddingModel,
        {
          quantized: false,
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
    } catch (error) {
      this.logger.error('Error initializing embedding model:', error);
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
        field_schema: 'keyword',
      });

      await this.qdrantClient.createPayloadIndex(this.collectionName, {
        field_name: 'speaker',
        field_schema: 'keyword',
      });

      await this.qdrantClient.createPayloadIndex(this.collectionName, {
        field_name: 'timestamp',
        field_schema: 'datetime',
      });

      this.logger.log('Created indexes successfully');
    } catch (error) {
      if (error.status !== 409) {
        this.logger.error('Error creating indexes:', error);
      }
    }
  }

  private async waitForModelLoad(): Promise<void> {
    while (!this.isEmbeddingModelLoaded) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    await this.waitForModelLoad();

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
    await this.waitForModelLoad();

    const embeddings: number[][] = [];
    const batchSize = 10;

    this.logger.log(`Generating embeddings for ${texts.length} texts...`);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map((text) => this.generateEmbedding(text));
      const batchEmbeddings = await Promise.all(batchPromises);
      embeddings.push(...batchEmbeddings);

      const processed = Math.min(i + batchSize, texts.length);
      this.logger.log(`Generated embeddings: ${processed}/${texts.length}`);
    }

    return embeddings;
  }

  private createContentHash(content: string, timestamp: string): string {
    const hashInput = `${content.trim()}_${timestamp}`;
    return createHash('md5').update(hashInput).digest('hex');
  }

  /**
   * Chunk transcripts to maintain context
   * Combines consecutive segments from the same speaker within a time window
   */
  private chunkTranscriptsForContext(transcripts: TranscriptData[]): Array<{
    content: string;
    speaker: string;
    speakerEmail: string;
    startTime: string;
    endTime: string;
    segmentCount: number;
  }> {
    if (transcripts.length === 0) return [];

    const chunks: Array<{
      content: string;
      speaker: string;
      speakerEmail: string;
      startTime: string;
      endTime: string;
      segmentCount: number;
    }> = [];

    let currentChunk = {
      content: transcripts[0].text,
      speaker: transcripts[0].speakerName,
      speakerEmail: transcripts[0].speakerEmail,
      startTime: transcripts[0].timestamp,
      endTime: transcripts[0].timestamp,
      segmentCount: 1,
    };

    for (let i = 1; i < transcripts.length; i++) {
      const current = transcripts[i];
      const lastTimestamp = new Date(currentChunk.endTime);
      const currentTimestamp = new Date(current.timestamp);
      const timeDiff = currentTimestamp.getTime() - lastTimestamp.getTime();

      // Merge if same speaker and within 30 seconds
      const shouldMerge =
        current.speakerEmail === currentChunk.speakerEmail && timeDiff < 60000; // 30 seconds

      if (shouldMerge) {
        // Merge into current chunk
        currentChunk.content += ' ' + current.text;
        currentChunk.endTime = current.timestamp;
        currentChunk.segmentCount++;
      } else {
        // Save current chunk and start new one
        chunks.push({ ...currentChunk });
        currentChunk = {
          content: current.text,
          speaker: current.speakerName,
          speakerEmail: current.speakerEmail,
          startTime: current.timestamp,
          endTime: current.timestamp,
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
    meetingId: string,
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

      // STEP 1: Chunk transcripts to maintain context
      const chunks = this.chunkTranscriptsForContext(transcripts);

      this.logger.log(
        `[VECTOR-STORAGE] Created ${chunks.length} context-aware chunks from ${transcripts.length} segments`,
      );

      // STEP 2: Create content texts for embeddings
      const contentTexts = chunks.map(
        (chunk) => `${chunk.speaker}: ${chunk.content}`,
      );

      // STEP 3: Generate embeddings for chunks
      const embeddings = await this.generateEmbeddings(contentTexts);

      // STEP 4: Create points for storage
      const points: Array<{
        id: string;
        vector: number[];
        payload: {
          meetingId: string;
          chunkId: string;
          content: string;
          speaker: string;
          speakerEmail: string;
          text: string;
          startTime: string;
          endTime: string;
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
        const contentHash = this.createContentHash(content, chunk.startTime);

        const point = {
          id: contentHash,
          vector: embeddings[i],
          payload: {
            meetingId,
            chunkId: uuidv4(),
            content,
            speaker: chunk.speaker,
            speakerEmail: chunk.speakerEmail,
            text: chunk.content,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            segmentCount: chunk.segmentCount,
            contentHash,
          },
        };

        points.push(point);
      }

      if (points.length === 0) {
        this.logger.error('No valid points to upsert');
        return;
      }

      await this.qdrantClient.upsert(this.collectionName, {
        wait: true,
        points,
      });

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
    meetingId: string,
    query: string,
    limit: number = 5,
  ): Promise<SearchResult[]> {
    try {
      this.logger.log(`Searching for: "${query}" in meeting ${meetingId}`);

      const queryEmbedding = await this.generateEmbedding(query);

      let searchResult;

      try {
        searchResult = await this.qdrantClient.search(this.collectionName, {
          vector: queryEmbedding,
          filter: {
            must: [
              {
                key: 'meetingId',
                match: { value: meetingId },
              },
            ],
          },
          limit,
          with_payload: true,
        });
      } catch (filterError) {
        this.logger.warn('Filtered search failed, using fallback');
        const allResults = await this.qdrantClient.search(this.collectionName, {
          vector: queryEmbedding,
          limit: limit * 10,
          with_payload: true,
        });

        searchResult = allResults
          .filter((hit) => hit.payload?.meetingId === meetingId)
          .slice(0, limit);
      }

      const results: SearchResult[] = searchResult.map((hit) => ({
        content: hit.payload?.content as string,
        score: hit.score,
        startTime: hit.payload?.startTime as string,
        endTime: hit.payload?.endTime as string,
        chunkId: hit.payload?.chunkId as string,
        speaker: hit.payload?.speaker as string,
        segmentCount: (hit.payload?.segmentCount as number) || 1,
      }));

      this.logger.log(`Found ${results.length} similar chunks`);
      return results;
    } catch (error) {
      this.logger.error('Error searching similar content:', error);
      throw error;
    }
  }

  async generateAnswer(
    question: string,
    searchResults: SearchResult[],
    meetingId: string,
  ): Promise<RAGAnswer> {
    try {
      const context = searchResults
        .map((result, index) => {
          const startTime = new Date(result.startTime).toLocaleTimeString();
          const endTime = new Date(result.endTime).toLocaleTimeString();
          const timeRange =
            result.startTime === result.endTime
              ? startTime
              : `${startTime} - ${endTime}`;
          const cleanContent = result.content.replace(
            `${result.speaker}: `,
            '',
          );
          return `[${index + 1}] ${result.speaker} (${timeRange}, ${result.segmentCount} segments): ${cleanContent}`;
        })
        .join('\n\n');

      const prompt = `You are an AI assistant that answers questions about meeting transcripts. 
Use only the information provided in the context to answer the question.
If the context doesn't contain enough information, say so clearly.
Always cite which speaker said what when referencing specific information.
Be concise but comprehensive in your response.

Question: "${question}"

Meeting Transcript Context:
${context}

Please provide a clear, accurate answer based only on the information provided above.`;

      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: prompt,
      });

      const answer = result.text || 'Unable to generate answer.';

      const sources = searchResults.map((result, index) => {
        const startTime = new Date(result.startTime).toLocaleTimeString();
        const endTime = new Date(result.endTime).toLocaleTimeString();
        const timeRange =
          result.startTime === result.endTime
            ? startTime
            : `${startTime} - ${endTime}`;
        const preview = result.content
          .replace(`${result.speaker}: `, '')
          .substring(0, 100);
        return `[${index + 1}] ${result.speaker} at ${timeRange} (${result.segmentCount} segments): "${preview}..."`;
      });

      this.logger.log(`Generated answer for meeting ${meetingId}`);

      return {
        answer,
        sources,
        // Note: Currently unused
        // relevantChunks: searchResults,
      };
    } catch (error) {
      this.logger.error('Error generating answer:', error);

      if (error.message?.includes('SAFETY')) {
        throw new Error(
          'Content was blocked by safety filters. Please rephrase your question.',
        );
      } else if (error.message?.includes('QUOTA_EXCEEDED')) {
        throw new Error('API quota exceeded. Please try again later.');
      } else {
        throw new Error(`Failed to generate answer: ${error.message}`);
      }
    }
  }

  async askQuestion(
    data: Omit<QAEntry, 'id' | 'meeting' | 'user' | 'answer' | 'status'>,
    // Todo: Make only one return type
  ): Promise<QAEntry> {
    try {
      this.logger.log(
        `Processing question for meeting ${data.meetingId}: "${data.question}"`,
      );

      const searchResults = await this.searchSimilarContent(
        data.meetingId,
        data.question,
        10,
      );
      let ragAnswer: RAGAnswer = {
        answer: '',
        sources: [],
      };
      if (searchResults.length === 0) {
        ragAnswer.answer =
          "I couldn't find any relevant information in the meeting transcript to answer your question. The meeting may not have covered this topic, or there might not be enough transcript data available yet.";
      } else {
        ragAnswer = await this.generateAnswer(
          data.question,
          searchResults.slice(0, 5),
          data.meetingId,
        );
      }

      const qaEntry = this.qaEntriesRepository.create({
        ...data,
        answer: ragAnswer.answer,
        sources: ragAnswer.sources,
        status: 'answered',
      });

      return await this.qaEntriesRepository.save(qaEntry);
    } catch (error) {
      this.logger.error('Error processing question:', error);
      throw error;
    }
  }
}

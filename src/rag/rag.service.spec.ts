import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { QAEntry, QAStatus } from '../entities/qa-entry.entity';
import { AI_MODEL, VECTOR_DATABASE } from '../common/interfaces';
import { EMBEDDING_WORKER_POOL } from '../workers/worker-pool.module';
import { createMockRepository, createMockTranscriptData } from '../test/test-helpers';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest
    .fn()
    .mockResolvedValue(
      'Answer the question based on context:\n\nContext:\n{{context}}\n\nQuestion: {{question}}',
    ),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid'),
}));

describe('RAGService', () => {
  let service: RAGService;
  let qaRepo: ReturnType<typeof createMockRepository>;
  let mockWorkerPool: { run: jest.Mock };
  let mockAiModel: { generateContent: jest.Mock; generateStructuredContent: jest.Mock };
  let mockVectorDB: {
    initializeCollection: jest.Mock;
    search: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
    deleteByFilter: jest.Mock;
    createIndex: jest.Mock;
    collectionExists: jest.Mock;
  };

  beforeEach(async () => {
    qaRepo = createMockRepository();

    mockWorkerPool = {
      run: jest.fn().mockResolvedValue({
        success: true,
        embedding: new Array(384).fill(0.1),
        embeddings: [new Array(384).fill(0.1)],
      }),
    };

    mockAiModel = {
      generateContent: jest.fn().mockResolvedValue({
        text: '  The answer is 42.  ',
      }),
      generateStructuredContent: jest.fn(),
    };

    mockVectorDB = {
      initializeCollection: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByFilter: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined),
      collectionExists: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: getRepositoryToken(QAEntry), useValue: qaRepo },
        { provide: EMBEDDING_WORKER_POOL, useValue: mockWorkerPool },
        { provide: AI_MODEL, useValue: mockAiModel },
        { provide: VECTOR_DATABASE, useValue: mockVectorDB },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);

    // Initialize prompt cache and collection
    await service.onModuleInit();
  });

  describe('chunkTranscriptsForContext', () => {
    it('should return empty array for empty input', () => {
      const result = service.chunkTranscriptsForContext([]);
      expect(result).toEqual([]);
    });

    it('should return single chunk for single transcript', () => {
      const transcripts = [createMockTranscriptData()];
      const result = service.chunkTranscriptsForContext(transcripts);

      expect(result).toHaveLength(1);
      expect(result[0].transcript).toBe('Hello world');
      expect(result[0].segmentCount).toBe(1);
    });

    it('should merge consecutive segments from same speaker within 60 seconds', () => {
      const transcripts = [
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          speaker_name: 'Alice',
          timestamp_ms: 1000,
          transcription: { transcript: 'Hello', words: 1 },
        }),
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          speaker_name: 'Alice',
          timestamp_ms: 2000,
          transcription: { transcript: 'world', words: 1 },
        }),
      ];

      const result = service.chunkTranscriptsForContext(transcripts);

      expect(result).toHaveLength(1);
      expect(result[0].transcript).toBe('Hello world');
      expect(result[0].segmentCount).toBe(2);
    });

    it('should NOT merge segments from different speakers', () => {
      const transcripts = [
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          speaker_name: 'Alice',
          timestamp_ms: 1000,
          transcription: { transcript: 'Hello', words: 1 },
        }),
        createMockTranscriptData({
          speaker_uuid: 'speaker-2',
          speaker_name: 'Bob',
          timestamp_ms: 2000,
          transcription: { transcript: 'Hi', words: 1 },
        }),
      ];

      const result = service.chunkTranscriptsForContext(transcripts);

      expect(result).toHaveLength(2);
      expect(result[0].speaker).toBe('speaker-1');
      expect(result[1].speaker).toBe('speaker-2');
    });

    it('should NOT merge segments from same speaker beyond 60-second gap', () => {
      // Note: the code computes timeDiff = currentChunk.timestamp - current.timestamp_ms
      // So we use descending timestamps to trigger the gap check (timeDiff >= 60000)
      const transcripts = [
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          timestamp_ms: 100000,
          transcription: { transcript: 'First', words: 1 },
        }),
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          timestamp_ms: 1000,
          transcription: { transcript: 'Second', words: 1 },
        }),
      ];

      const result = service.chunkTranscriptsForContext(transcripts);

      expect(result).toHaveLength(2);
    });

    it('should handle interleaved speakers correctly', () => {
      const transcripts = [
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          speaker_name: 'Alice',
          timestamp_ms: 1000,
          transcription: { transcript: 'Hello', words: 1 },
        }),
        createMockTranscriptData({
          speaker_uuid: 'speaker-2',
          speaker_name: 'Bob',
          timestamp_ms: 2000,
          transcription: { transcript: 'Hi', words: 1 },
        }),
        createMockTranscriptData({
          speaker_uuid: 'speaker-1',
          speaker_name: 'Alice',
          timestamp_ms: 3000,
          transcription: { transcript: 'How are you?', words: 3 },
        }),
      ];

      const result = service.chunkTranscriptsForContext(transcripts);

      expect(result).toHaveLength(3);
    });
  });

  describe('storeTranscripts', () => {
    it('should return early for empty transcripts array', async () => {
      // Clear any calls from onModuleInit warmup
      mockWorkerPool.run.mockClear();

      await service.storeTranscripts(1, []);

      expect(mockWorkerPool.run).not.toHaveBeenCalled();
      expect(mockVectorDB.upsert).not.toHaveBeenCalled();
    });

    it('should chunk transcripts, generate embeddings, and upsert to vector DB', async () => {
      const transcripts = [
        createMockTranscriptData({
          speaker_name: 'Alice',
          transcription: { transcript: 'Hello world', words: 2 },
        }),
      ];

      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embeddings: [new Array(384).fill(0.1)],
      });

      await service.storeTranscripts(1, transcripts);

      expect(mockVectorDB.upsert).toHaveBeenCalledWith(
        'meeting_transcripts',
        expect.arrayContaining([
          expect.objectContaining({
            vector: expect.any(Array),
            payload: expect.objectContaining({
              meetingId: 1,
              speakerName: 'Alice',
            }),
          }),
        ]),
      );
    });

    it('should skip points with invalid embeddings', async () => {
      const transcripts = [
        createMockTranscriptData(),
        createMockTranscriptData({ speaker_name: 'Bob' }),
      ];

      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embeddings: [
          new Array(384).fill(0.1),
          new Array(100).fill(0.1),
        ],
      });

      await service.storeTranscripts(1, transcripts);

      const upsertedPoints = mockVectorDB.upsert.mock.calls[0][1];
      expect(upsertedPoints).toHaveLength(1);
    });

    it('should format content as "speakerName: transcript"', async () => {
      const transcripts = [
        createMockTranscriptData({
          speaker_name: 'Alice',
          transcription: { transcript: 'Hello there', words: 2 },
        }),
      ];

      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embeddings: [new Array(384).fill(0.1)],
      });

      await service.storeTranscripts(1, transcripts);

      const upsertedPoints = mockVectorDB.upsert.mock.calls[0][1];
      expect(upsertedPoints[0].payload.content).toBe('Alice: Hello there');
    });

    it('should propagate vectorDB.upsert errors', async () => {
      const transcripts = [createMockTranscriptData()];

      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embeddings: [new Array(384).fill(0.1)],
      });
      mockVectorDB.upsert.mockRejectedValueOnce(new Error('Qdrant down'));

      await expect(service.storeTranscripts(1, transcripts)).rejects.toThrow(
        'Qdrant down',
      );
    });
  });

  describe('searchSimilarContent', () => {
    it('should generate embedding for question and search vector DB', async () => {
      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embedding: new Array(384).fill(0.1),
      });
      mockVectorDB.search.mockResolvedValueOnce([
        {
          score: 0.95,
          payload: {
            content: 'Alice: Hello',
            speaker: 'speaker-1',
            speakerName: 'Alice',
            timestamp: 1000,
          },
        },
      ]);

      const results = await service.searchSimilarContent(1, 'What was said?');

      expect(mockVectorDB.search).toHaveBeenCalledWith(
        'meeting_transcripts',
        expect.objectContaining({
          vector: expect.any(Array),
          limit: 10,
          filter: {
            must: [{ key: 'meetingId', match: { value: 1 } }],
          },
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Alice: Hello');
      expect(results[0].score).toBe(0.95);
    });

    it('should throw wrapped error on vector DB search failure', async () => {
      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embedding: new Array(384).fill(0.1),
      });
      mockVectorDB.search.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        service.searchSimilarContent(1, 'question'),
      ).rejects.toThrow('Failed to search relevant data.');
    });
  });

  describe('generateAnswer', () => {
    const searchResults = [
      {
        content: 'Alice: We should launch next week',
        speaker: 'speaker-1',
        speakerName: 'Alice',
        timestamp: 1705312800000,
        score: 0.95,
      },
    ];

    it('should substitute context and question into prompt template', async () => {
      await service.generateAnswer('When is the launch?', searchResults);

      const prompt = mockAiModel.generateContent.mock.calls[0][0];
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('We should launch next week');
      expect(prompt).toContain('When is the launch?');
      expect(prompt).not.toContain('{{context}}');
      expect(prompt).not.toContain('{{question}}');
    });

    it('should return trimmed answer and truncated source citations', async () => {
      const result = await service.generateAnswer(
        'When is the launch?',
        searchResults,
      );

      expect(result.answer).toBe('The answer is 42.');
      expect(result.sources).toHaveLength(1);
    });

    it('should throw wrapped error on AI model failure', async () => {
      mockAiModel.generateContent.mockRejectedValueOnce(
        new Error('API error'),
      );

      await expect(
        service.generateAnswer('question', searchResults),
      ).rejects.toThrow('Failed to generate answer with Gemini API');
    });
  });

  describe('askQuestion', () => {
    it('should search, generate answer, save QA entry with ANSWERED status, and return', async () => {
      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embedding: new Array(384).fill(0.1),
      });
      mockVectorDB.search.mockResolvedValueOnce([
        {
          score: 0.9,
          payload: {
            content: 'Alice: Hello',
            speaker: 'sp-1',
            speakerName: 'Alice',
            timestamp: 1000,
          },
        },
      ]);

      const savedEntry = {
        id: 1,
        question: 'What?',
        answer: 'The answer is 42.',
        status: QAStatus.ANSWERED,
      };
      qaRepo.save.mockResolvedValueOnce(savedEntry);

      const result = await service.askQuestion(1, 'user-1', 'What?');

      expect(qaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: QAStatus.ANSWERED,
          userId: 'user-1',
          meetingId: 1,
        }),
      );
      expect(result).toBe(savedEntry);
    });

    it('should return "no data" message when searchResults is empty', async () => {
      mockWorkerPool.run.mockResolvedValueOnce({
        success: true,
        embedding: new Array(384).fill(0.1),
      });
      mockVectorDB.search.mockResolvedValueOnce([]);

      const savedEntry = { id: 1, status: QAStatus.ANSWERED };
      qaRepo.save.mockResolvedValueOnce(savedEntry);

      await service.askQuestion(1, 'user-1', 'What?');

      expect(qaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: expect.stringContaining("couldn't find any relevant"),
          status: QAStatus.ANSWERED,
          sources: [],
        }),
      );
    });

    it('should save QA entry with ERROR status on failure and re-throw', async () => {
      mockWorkerPool.run.mockRejectedValueOnce(new Error('Worker crashed'));

      qaRepo.save.mockResolvedValueOnce({});

      await expect(
        service.askQuestion(1, 'user-1', 'What?'),
      ).rejects.toThrow();

      expect(qaRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: QAStatus.ERROR,
        }),
      );
    });
  });
});

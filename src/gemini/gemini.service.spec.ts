import { Test, TestingModule } from '@nestjs/testing';
import { GeminiService } from './gemini.service';
import { AI_MODEL } from '../common/interfaces';
import { createMockTranscriptData } from '../test/test-helpers';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest
    .fn()
    .mockResolvedValue('Summarize this conversation:\n{{conversation}}'),
}));

describe('GeminiService', () => {
  let service: GeminiService;
  let mockAiModel: { generateContent: jest.Mock; generateStructuredContent: jest.Mock };

  beforeEach(async () => {
    mockAiModel = {
      generateContent: jest.fn().mockResolvedValue({
        text: '  This is a summary.  ',
      }),
      generateStructuredContent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: AI_MODEL, useValue: mockAiModel },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);

    // Load prompt cache
    await service.onModuleInit();
  });

  describe('generateSummary', () => {
    it('should format transcripts as "speaker: text" lines joined by newlines', async () => {
      const transcripts = [
        createMockTranscriptData({ speaker_name: 'Alice', transcription: { transcript: 'Hello', words: 1 } }),
        createMockTranscriptData({ speaker_name: 'Bob', transcription: { transcript: 'Hi there', words: 2 } }),
      ];

      await service.generateSummary(transcripts);

      const prompt = mockAiModel.generateContent.mock.calls[0][0];
      expect(prompt).toContain('Alice: Hello');
      expect(prompt).toContain('Bob: Hi there');
    });

    it('should substitute conversation text into summary prompt template', async () => {
      const transcripts = [
        createMockTranscriptData({ speaker_name: 'Alice', transcription: { transcript: 'Test', words: 1 } }),
      ];

      await service.generateSummary(transcripts);

      const prompt = mockAiModel.generateContent.mock.calls[0][0];
      expect(prompt).toContain('Summarize this conversation:');
      expect(prompt).toContain('Alice: Test');
      expect(prompt).not.toContain('{{conversation}}');
    });

    it('should call aiModel.generateContent with the formatted prompt', async () => {
      const transcripts = [createMockTranscriptData()];

      await service.generateSummary(transcripts);

      expect(mockAiModel.generateContent).toHaveBeenCalledTimes(1);
      expect(typeof mockAiModel.generateContent.mock.calls[0][0]).toBe('string');
    });

    it('should return trimmed summary text', async () => {
      const transcripts = [createMockTranscriptData()];

      const result = await service.generateSummary(transcripts);

      expect(result).toBe('This is a summary.');
    });

    it('should return "Unable to generate answer." when AI returns empty text', async () => {
      mockAiModel.generateContent.mockResolvedValueOnce({ text: '' });
      const transcripts = [createMockTranscriptData()];

      const result = await service.generateSummary(transcripts);

      expect(result).toBe('Unable to generate answer.');
    });

    it('should throw wrapped error on AI model failure', async () => {
      mockAiModel.generateContent.mockRejectedValueOnce(
        new Error('API rate limit exceeded'),
      );
      const transcripts = [createMockTranscriptData()];

      await expect(service.generateSummary(transcripts)).rejects.toThrow(
        'Failed to generate summary with Gemini API',
      );
    });

    it('should handle empty transcripts array', async () => {
      const result = await service.generateSummary([]);

      expect(mockAiModel.generateContent).toHaveBeenCalled();
      expect(typeof result).toBe('string');
    });
  });
});

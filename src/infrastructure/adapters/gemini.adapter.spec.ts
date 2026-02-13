/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Mock the @google/genai module before importing the adapter.
 * The adapter calls `new GoogleGenAI(...)` in its constructor, so
 * we need the mock in place before the module is loaded.
 */
const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import { GeminiAdapter } from './gemini.adapter';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
    adapter = new GeminiAdapter();
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  // ---------- generateContent ----------

  describe('generateContent', () => {
    it('should return text, finishReason and usage from the SDK response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Hello from Gemini',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      });

      const result = await adapter.generateContent('Say hello');

      expect(result).toEqual({
        text: 'Hello from Gemini',
        finishReason: 'STOP',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      });
    });

    it('should use the default model when no options are provided', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'ok' });

      await adapter.generateContent('test prompt');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-flash-001' }),
      );
    });

    it('should use a custom model when specified in options', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'ok' });

      await adapter.generateContent('prompt', { model: 'gemini-pro' });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-pro' }),
      );
    });

    it('should pass temperature, maxTokens, and stopSequences in the config', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'ok' });

      await adapter.generateContent('prompt', {
        temperature: 0.7,
        maxTokens: 256,
        stopSequences: ['END'],
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            temperature: 0.7,
            maxOutputTokens: 256,
            stopSequences: ['END'],
          }),
        }),
      );
    });

    it('should default text to empty string when SDK returns null text', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
        candidates: [],
        usageMetadata: null,
      });

      const result = await adapter.generateContent('prompt');

      expect(result.text).toBe('');
      expect(result.usage).toBeUndefined();
    });

    it('should re-throw errors from the SDK', async () => {
      const sdkError = new Error('Quota exceeded');
      mockGenerateContent.mockRejectedValue(sdkError);

      await expect(adapter.generateContent('prompt')).rejects.toThrow(
        'Quota exceeded',
      );
    });
  });

  // ---------- generateStructuredContent ----------

  describe('generateStructuredContent', () => {
    it('should parse the JSON response and return typed data', async () => {
      const expected = { name: 'Alice', age: 30 };
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(expected),
      });

      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };

      const result = await adapter.generateStructuredContent<{
        name: string;
        age: number;
      }>('Give me a person', schema);

      expect(result).toEqual(expected);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            responseMimeType: 'application/json',
            responseSchema: schema,
          }),
        }),
      );
    });

    it('should return an empty object when SDK returns null text', async () => {
      mockGenerateContent.mockResolvedValue({ text: null });

      const result = await adapter.generateStructuredContent(
        'prompt',
        { type: 'object' },
      );

      expect(result).toEqual({});
    });
  });
});

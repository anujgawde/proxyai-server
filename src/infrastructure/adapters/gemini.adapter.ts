import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import {
  IAIModel,
  GenerateContentOptions,
  GenerateContentResult,
} from '../../common/interfaces';

/**
 * Gemini Adapter
 */
@Injectable()
export class GeminiAdapter implements IAIModel {
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly client: GoogleGenAI;
  private readonly defaultModel = 'gemini-2.0-flash-001';

  constructor() {
    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    this.logger.log('Gemini adapter initialized');
  }

  /**
   * Generate text content from a prompt
   */
  async generateContent(
    prompt: string,
    options?: GenerateContentOptions,
  ): Promise<GenerateContentResult> {
    try {
      const model = options?.model || this.defaultModel;

      const result = await this.client.models.generateContent({
        model,
        contents: prompt,
        config: this.buildConfig(options),
      });

      return {
        text: result.text || '',
        finishReason: result.candidates?.[0]?.finishReason,
        usage: result.usageMetadata
          ? {
              promptTokens: result.usageMetadata.promptTokenCount || 0,
              completionTokens: result.usageMetadata.candidatesTokenCount || 0,
              totalTokens: result.usageMetadata.totalTokenCount || 0,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error(`Content generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Generate content with structured output (JSON)
   */
  async generateStructuredContent<T>(
    prompt: string,
    schema: object,
    options?: GenerateContentOptions,
  ): Promise<T> {
    try {
      const model = options?.model || this.defaultModel;

      const result = await this.client.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...this.buildConfig(options),
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });

      const text = result.text || '{}';
      return JSON.parse(text) as T;
    } catch (error) {
      this.logger.error(`Structured content generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Build Gemini config from options
   */
  private buildConfig(options?: GenerateContentOptions): any {
    if (!options) return undefined;

    const config: any = {};

    if (options.temperature !== undefined) {
      config.temperature = options.temperature;
    }

    if (options.maxTokens !== undefined) {
      config.maxOutputTokens = options.maxTokens;
    }

    if (options.stopSequences && options.stopSequences.length > 0) {
      config.stopSequences = options.stopSequences;
    }

    return Object.keys(config).length > 0 ? config : undefined;
  }
}

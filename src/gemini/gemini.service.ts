import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TranscriptData } from 'src/entities/transcript-entry.entity';
import { AI_MODEL } from 'src/common/interfaces';
import type { IAIModel } from 'src/common/interfaces';

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);

  // Prompt cache - loaded once at startup
  private promptCache: Map<string, string> = new Map();

  constructor(
    @Inject(AI_MODEL) private readonly aiModel: IAIModel,
  ) {}

  async onModuleInit() {
    await this.loadPromptCache();
  }

  /**
   * Load all prompt templates into memory at startup
   */
  private async loadPromptCache(): Promise<void> {
    try {
      const promptsDir = path.join(__dirname, 'prompts');

      // Load summary prompt
      const summaryPromptPath = path.join(promptsDir, 'summary_prompt.txt');
      const summaryPrompt = await fs.readFile(summaryPromptPath, 'utf-8');
      this.promptCache.set('summary', summaryPrompt);

      this.logger.log('Gemini prompt templates loaded into cache');
    } catch (error) {
      this.logger.error('Error loading prompt cache:', error);
      throw new Error('Failed to load Gemini prompt templates');
    }
  }

  async generateSummary(transcripts: TranscriptData[]): Promise<string> {
    try {
      // Format transcripts into a readable conversation
      const conversationText = transcripts
        .map((t) => `${t.speaker_name}: ${t.transcription.transcript}`)
        .join('\n');

      // Get summary prompt from cache
      const summaryPrompt = this.promptCache.get('summary');
      if (!summaryPrompt) {
        throw new Error('Summary prompt template not loaded');
      }

      const prompt = summaryPrompt.replace(
        '{{conversation}}',
        conversationText,
      );

      const result = await this.aiModel.generateContent(prompt);
      const response = result.text || 'Unable to generate answer.';
      const summary = response;

      this.logger.log(`Generated summary: ${summary.substring(0, 100)}...`);
      return summary.trim();
    } catch (error) {
      this.logger.error('Error generating summary:', error);
      throw new Error('Failed to generate summary with Gemini API');
    }
  }
}

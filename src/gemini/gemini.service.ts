import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptData } from 'src/entities/transcript-entry.entity';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }

    this.genAI = this.genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  async generateSummary(transcripts: TranscriptData[]): Promise<string> {
    try {
      // Format transcripts into a readable conversation
      const conversationText = transcripts
        .map((t) => `${t.speakerName}: ${t.text}`)
        .join('\n');

      const promptPath = path.join(__dirname, 'prompts', 'summary_prompt.txt');
      const summaryPrompt = fs.readFileSync(promptPath, 'utf-8');
      const prompt = summaryPrompt.replace(
        '{{conversation}}',
        conversationText,
      );

      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.0-flash-001',
        contents: prompt,
      });
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

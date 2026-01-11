import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptData } from 'src/entities/transcript-entry.entity';

@Injectable()
export class GeminiService {
  private genAI: GoogleGenAI;
  private llmModel = process.env.LLM_MODEL;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }

    this.genAI = this.genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  /**
   * 
  Generates a summary based on the input Transcripts.
  */
  async generateSummary(transcripts: TranscriptData[]): Promise<string> {
    try {
      const conversationText = transcripts
        .map((t) => `${t.speaker_name}: ${t.transcription.transcript}`)
        .join('\n');

      const promptPath = path.join(__dirname, 'prompts', 'summary_prompt.txt');
      const summaryPrompt = fs.readFileSync(promptPath, 'utf-8');
      const prompt = summaryPrompt.replace(
        '{{conversation}}',
        conversationText,
      );
      if (!this.llmModel) {
        throw new Error('LLM Model not found.');
      }
      const result = await this.genAI.models.generateContent({
        model: this.llmModel,
        contents: prompt,
      });
      const summary = result.text || 'Unable to generate answer.';
      return summary.trim();
    } catch (error) {
      throw new Error('Failed to generate summary with Gemini API');
    }
  }
}

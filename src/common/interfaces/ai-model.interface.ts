/**
 * AI Model Interface
 */

/**
 * Options for content generation
 */
export interface GenerateContentOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/**
 * Result from content generation
 */
export interface GenerateContentResult {
  text: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Options for embedding generation
 */
export interface GenerateEmbeddingOptions {
  model?: string;
}

/**
 * AI Model Interface for text generation
 */
export interface IAIModel {
  /**
   * Generate text content from a prompt
   */
  generateContent(
    prompt: string,
    options?: GenerateContentOptions,
  ): Promise<GenerateContentResult>;

  /**
   * Generate content with structured output (JSON)
   */
  generateStructuredContent?<T>(
    prompt: string,
    schema: object,
    options?: GenerateContentOptions,
  ): Promise<T>;
}

/**
 * AI Embedding Model Interface
 */
export interface IEmbeddingModel {
  /**
   * Generate embedding for a single text
   */
  generateEmbedding(
    text: string,
    options?: GenerateEmbeddingOptions,
  ): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts (batch)
   */
  generateEmbeddings(
    texts: string[],
    options?: GenerateEmbeddingOptions,
  ): Promise<number[][]>;

  /**
   * Get the dimension size of embeddings
   */
  getEmbeddingDimension(): number;
}

/**
 * Tokens for dependency injection
 */
export const AI_MODEL = 'AI_MODEL';
export const EMBEDDING_MODEL = 'EMBEDDING_MODEL';

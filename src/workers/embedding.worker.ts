import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.allowRemoteModels = true;
env.allowLocalModels = true;

// Embedding model - loaded once per worker thread
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
let embeddingPipeline: any = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

async function initializePipeline(): Promise<void> {
  if (embeddingPipeline) return;
  if (initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    embeddingPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      quantized: false,
    });
    isInitializing = false;
  })();

  return initPromise;
}

interface EmbeddingTask {
  type: 'single' | 'batch';
  text?: string;
  texts?: string[];
}

interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  embeddings?: number[][];
  error?: string;
}

export default async function processEmbedding(
  task: EmbeddingTask,
): Promise<EmbeddingResult> {
  try {
    await initializePipeline();

    if (task.type === 'single' && task.text) {
      const output = await embeddingPipeline(task.text, {
        pooling: 'mean',
        normalize: true,
      });

      const embedding = Array.from(output.data) as number[];

      if (!Array.isArray(embedding) || embedding.length === 0) {
        return { success: false, error: 'Invalid embedding generated' };
      }

      return { success: true, embedding };
    }

    if (task.type === 'batch' && task.texts) {
      const embeddings: number[][] = [];

      for (const text of task.texts) {
        const output = await embeddingPipeline(text, {
          pooling: 'mean',
          normalize: true,
        });

        const embedding = Array.from(output.data) as number[];

        if (!Array.isArray(embedding) || embedding.length === 0) {
          return {
            success: false,
            error: `Invalid embedding generated for text: ${text.substring(0, 50)}...`,
          };
        }

        embeddings.push(embedding);
      }

      return { success: true, embeddings };
    }

    return { success: false, error: 'Invalid task type or missing text' };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Unknown error during embedding generation',
    };
  }
}

/**
 * Vector Database Interface
 */

/**
 * Definition for a payload index
 */
export interface IndexDefinition {
  fieldName: string;
  fieldType: 'integer' | 'keyword' | 'float' | 'text' | 'bool';
}

/**
 * Optional vendor-specific collection configuration
 */
export interface CollectionConfig {
  optimizerConfig?: Record<string, any>;
  replicationFactor?: number;
}

/**
 * A point to be stored in the vector database
 */
export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

/**
 * Search result from vector database
 */
export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, any>;
}

/**
 * Filter condition for vector search
 */
export interface VectorFilter {
  must?: Array<{
    key: string;
    match: { value: string | number | boolean };
  }>;
  should?: Array<{
    key: string;
    match: { value: string | number | boolean };
  }>;
}

/**
 * Search options
 */
export interface VectorSearchOptions {
  vector: number[];
  limit: number;
  filter?: VectorFilter;
  withPayload?: boolean;
}

/**
 * Vector Database Interface
 */
export interface IVectorDatabase {
  /**
   * Initialize the collection/index if it doesn't exist
   */
  initializeCollection(
    collectionName: string,
    vectorSize: number,
    config?: CollectionConfig,
  ): Promise<void>;

  /**
   * Search for similar vectors
   */
  search(
    collectionName: string,
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]>;

  /**
   * Insert or update vectors
   */
  upsert(collectionName: string, points: VectorPoint[]): Promise<void>;

  /**
   * Delete vectors by IDs
   */
  delete(collectionName: string, ids: string[]): Promise<void>;

  /**
   * Delete vectors matching a filter
   */
  deleteByFilter(collectionName: string, filter: VectorFilter): Promise<void>;

  /**
   * Create a payload index on a collection
   */
  createIndex(
    collectionName: string,
    index: IndexDefinition,
  ): Promise<void>;

  /**
   * Check if a collection exists
   */
  collectionExists(collectionName: string): Promise<boolean>;
}

/**
 * Token for dependency injection
 */
export const VECTOR_DATABASE = 'VECTOR_DATABASE';

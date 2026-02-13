import { Injectable, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  IVectorDatabase,
  VectorPoint,
  VectorSearchResult,
  VectorSearchOptions,
  VectorFilter,
  IndexDefinition,
  CollectionConfig,
} from '../../common/interfaces';

/**
 * Qdrant Adapter
 */
@Injectable()
export class QdrantAdapter implements IVectorDatabase {
  private readonly logger = new Logger(QdrantAdapter.name);
  private readonly client: QdrantClient;

  constructor() {
    this.client = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });
    this.logger.log('Qdrant adapter initialized');
  }

  /**
   * Initialize a collection with the specified vector size
   */
  async initializeCollection(
    collectionName: string,
    vectorSize: number,
    config?: CollectionConfig,
  ): Promise<void> {
    try {
      const exists = await this.collectionExists(collectionName);

      if (!exists) {
        const createParams: any = {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        };

        if (config?.optimizerConfig) {
          createParams.optimizers_config = config.optimizerConfig;
        }
        if (config?.replicationFactor !== undefined) {
          createParams.replication_factor = config.replicationFactor;
        }

        await this.client.createCollection(collectionName, createParams);
        this.logger.log(
          `Created collection '${collectionName}' with vector size ${vectorSize}`,
        );
      } else {
        this.logger.log(`Collection '${collectionName}' already exists`);
      }
    } catch (error) {
      this.logger.error(`Failed to initialize collection: ${error}`);
      throw error;
    }
  }

  /**
   * Search for similar vectors
   */
  async search(
    collectionName: string,
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    try {
      const searchResults = await this.client.search(collectionName, {
        vector: options.vector,
        limit: options.limit,
        filter: options.filter ? this.convertFilter(options.filter) : undefined,
        with_payload: options.withPayload ?? true,
      });

      return searchResults.map((result) => ({
        id: String(result.id),
        score: result.score,
        payload: (result.payload as Record<string, any>) || {},
      }));
    } catch (error) {
      this.logger.error(`Search failed: ${error}`);
      throw error;
    }
  }

  /**
   * Insert or update vectors
   */
  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    try {
      await this.client.upsert(collectionName, {
        wait: true,
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
      this.logger.debug(
        `Upserted ${points.length} points to ${collectionName}`,
      );
    } catch (error) {
      this.logger.error(`Upsert failed: ${error}`);
      throw error;
    }
  }

  /**
   * Delete vectors by IDs
   */
  async delete(collectionName: string, ids: string[]): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: ids,
      });
      this.logger.debug(`Deleted ${ids.length} points from ${collectionName}`);
    } catch (error) {
      this.logger.error(`Delete failed: ${error}`);
      throw error;
    }
  }

  /**
   * Delete vectors matching a filter
   */
  async deleteByFilter(
    collectionName: string,
    filter: VectorFilter,
  ): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        filter: this.convertFilter(filter),
      });
      this.logger.debug(`Deleted points by filter from ${collectionName}`);
    } catch (error) {
      this.logger.error(`Delete by filter failed: ${error}`);
      throw error;
    }
  }

  /**
   * Create a payload index on a collection
   */
  async createIndex(
    collectionName: string,
    index: IndexDefinition,
  ): Promise<void> {
    try {
      await this.client.createPayloadIndex(collectionName, {
        field_name: index.fieldName,
        field_schema: index.fieldType,
      });
      this.logger.debug(
        `Created index '${index.fieldName}' on ${collectionName}`,
      );
    } catch (error: any) {
      if (error.status === 409) {
        return;
      }
      this.logger.error(`Failed to create index: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a collection exists
   */
  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some((c) => c.name === collectionName);
    } catch (error) {
      this.logger.error(`Collection exists check failed: ${error}`);
      return false;
    }
  }

  /**
   * Convert filter format to Qdrant's filter format
   */
  private convertFilter(filter: VectorFilter): any {
    const qdrantFilter: any = {};

    if (filter.must && filter.must.length > 0) {
      qdrantFilter.must = filter.must.map((condition) => ({
        key: condition.key,
        match: condition.match,
      }));
    }

    if (filter.should && filter.should.length > 0) {
      qdrantFilter.should = filter.should.map((condition) => ({
        key: condition.key,
        match: condition.match,
      }));
    }

    return qdrantFilter;
  }
}

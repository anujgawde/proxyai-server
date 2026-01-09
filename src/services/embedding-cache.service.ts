import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';

interface CacheStats {
  size: number;
  max: number;
  hits: number;
  misses: number;
  hitRate: number;
}

@Injectable()
export class EmbeddingCacheService {
  private readonly logger = new Logger(EmbeddingCacheService.name);
  private cache: LRUCache<string, number[]>;
  private hits = 0;
  private misses = 0;

  constructor() {
    // Free tier config: 5000 embeddings (~15MB RAM)
    const maxSize = parseInt(process.env.CACHE_SIZE || '5000', 10);
    const ttl = 3 * 24 * 60 * 60 * 1000; // 3 days

    this.cache = new LRUCache<string, number[]>({
      max: maxSize,
      ttl: ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.logger.log(
      `Embedding cache initialized with max size: ${maxSize}, TTL: ${ttl}ms`,
    );
  }

  /**
   * Get embedding from cache
   */
  async get(text: string): Promise<number[] | undefined> {
    const key = this.hashText(text);
    const cached = this.cache.get(key);

    if (cached) {
      this.hits++;
      this.logger.debug(`Cache hit for text: ${text.substring(0, 50)}...`);
      return cached;
    }

    this.misses++;
    this.logger.debug(`Cache miss for text: ${text.substring(0, 50)}...`);
    return undefined;
  }

  /**
   * Set embedding in cache
   */
  async set(text: string, embedding: number[]): Promise<void> {
    const key = this.hashText(text);
    this.cache.set(key, embedding);
    this.logger.debug(
      `Cached embedding for text: ${text.substring(0, 50)}...`,
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      size: this.cache.size,
      max: this.cache.max,
      hits: this.hits,
      misses: this.misses,
      hitRate: parseFloat((hitRate * 100).toFixed(2)),
    };
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.logger.log('Cache cleared');
  }

  /**
   * Hash text to create cache key
   */
  private hashText(text: string): string {
    return createHash('md5').update(text.trim()).digest('hex');
  }

  /**
   * Log cache statistics
   */
  logStats(): void {
    const stats = this.getCacheStats();
    this.logger.log(
      `Cache Stats - Size: ${stats.size}/${stats.max}, ` +
        `Hits: ${stats.hits}, Misses: ${stats.misses}, ` +
        `Hit Rate: ${stats.hitRate}%`,
    );
  }
}

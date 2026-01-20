import {
  Module,
  Global,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import Piscina from 'piscina';
import * as path from 'path';

export const EMBEDDING_WORKER_POOL = 'EMBEDDING_WORKER_POOL';

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_WORKER_POOL,
      useFactory: () => {
        const logger = new Logger('EmbeddingWorkerPool');

        const workerPath = path.resolve(__dirname, 'embedding.worker.js');

        logger.log(`Initializing embedding worker pool...`);
        logger.log(`Worker path: ${workerPath}`);

        const pool = new Piscina({
          filename: workerPath,
          minThreads: 2,
          maxThreads: 4,
          idleTimeout: 60000, // 1 minute idle timeout
        });

        logger.log(
          `Embedding worker pool initialized with ${pool.threads.length} threads`,
        );

        return pool;
      },
    },
  ],
  exports: [EMBEDDING_WORKER_POOL],
})
export class WorkerPoolModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPoolModule.name);

  async onModuleInit() {
    this.logger.log('Worker pool module initialized');
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down worker pools...');
  }
}

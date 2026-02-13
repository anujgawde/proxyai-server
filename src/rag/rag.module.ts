import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { WorkerPoolModule } from 'src/workers/worker-pool.module';
import { InfrastructureModule } from 'src/infrastructure/infrastructure.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([QAEntry]),
    WorkerPoolModule,
    InfrastructureModule,
  ],
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}

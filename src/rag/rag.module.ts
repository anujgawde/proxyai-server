import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { WorkerPoolModule } from 'src/workers/worker-pool.module';

@Module({
  imports: [TypeOrmModule.forFeature([QAEntry]), WorkerPoolModule],
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}

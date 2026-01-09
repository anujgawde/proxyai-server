import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { EmbeddingCacheService } from 'src/services/embedding-cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([QAEntry])],
  providers: [RAGService, EmbeddingCacheService],
  exports: [RAGService],
})
export class RAGModule {}

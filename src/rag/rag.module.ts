import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { QAEntry } from 'src/entities/qa-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([QAEntry])],
  providers: [RAGService],
  exports: [RAGService],
})
export class RAGModule {}

import { Module } from '@nestjs/common';
import { GeminiAdapter, QdrantAdapter } from './adapters';
import { AI_MODEL, VECTOR_DATABASE } from '../common/interfaces';

@Module({
  providers: [
    { provide: AI_MODEL, useClass: GeminiAdapter },
    { provide: VECTOR_DATABASE, useClass: QdrantAdapter },
  ],
  exports: [AI_MODEL, VECTOR_DATABASE],
})
export class InfrastructureModule {}

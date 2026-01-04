// src/sse/sse.module.ts
import { Module } from '@nestjs/common';
import { SseService } from './sse.service';
import { SseController } from './sse.controller';
import { MeetingsModule } from 'src/meetings/meetings.module';

@Module({
  imports: [MeetingsModule],
  controllers: [SseController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}

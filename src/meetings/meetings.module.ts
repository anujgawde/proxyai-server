import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { FirebaseService } from 'src/auth/firebase.service';
import { User } from 'src/entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from 'src/entities/meeting.entity';
import { TranscriptEntry } from 'src/entities/transcript-entry.entity';
import { TranscriptSegment } from 'src/entities/transcript-segment.entity';
import { Summary } from 'src/entities/summary.entity';
import { TranscriptsService } from 'src/transcripts/transcripts.service';
import { GeminiService } from 'src/gemini/gemini.service';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { MeetingsScheduler } from './meetings.scheduler';
import { Provider } from 'src/entities/providers.entity';
import { RAGModule } from 'src/rag/rag.module';
import { ProvidersModule } from 'src/providers/providers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Meeting,
      TranscriptEntry,
      TranscriptSegment,
      Summary,
      QAEntry,
      Provider,
    ]),
    RAGModule,
    ProvidersModule,
  ],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
    FirebaseService,
    FirebaseAuthGuard,
    TranscriptsService,
    GeminiService,
    MeetingsScheduler,
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}

import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { FirebaseService } from 'src/auth/firebase.service';
import { User } from 'src/entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from 'src/entities/meeting.entity';
import { MeetingsGateway } from './meetings.gateway';
import { TranscriptEntry } from 'src/entities/transcript-entry.entity';
import { Summary } from 'src/entities/summary.entity';
import { TranscriptsService } from 'src/transcripts/transcripts.service';
import { GeminiService } from 'src/gemini/gemini.service';
import { RAGService } from 'src/rag/rag.service';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { MeetingsScheduler } from './meetings.scheduler';
import { ProvidersZoomService } from 'src/providers/providers-zoom.service';
import { ProvidersGoogleService } from 'src/providers/providers-google.service';
import { Provider } from 'src/entities/providers.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Meeting,
      TranscriptEntry,
      Summary,
      QAEntry,
      Provider,
    ]),
  ],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
    FirebaseService,
    FirebaseAuthGuard,
    MeetingsGateway,
    TranscriptsService,
    GeminiService,
    RAGService,
    MeetingsScheduler,
    ProvidersZoomService,
    ProvidersGoogleService,
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}

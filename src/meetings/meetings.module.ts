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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Meeting,
      TranscriptEntry,
      Summary,
      QAEntry,
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
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}

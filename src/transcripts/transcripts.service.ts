import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TranscriptEntry,
  TranscriptData,
} from 'src/entities/transcript-entry.entity';
import { Meeting } from 'src/entities/meeting.entity';
import { GeminiService } from 'src/gemini/gemini.service';
import { Summary } from 'src/entities/summary.entity';
import { RAGService } from 'src/rag/rag.service';
import { MeetingsService } from 'src/meetings/meetings.service';
import { TranscriptSegment } from 'src/entities/transcript-segment.entity';

interface BufferMetadata {
  transcripts: TranscriptData[];
  timeStart: string;
}

@Injectable()
export class TranscriptsService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscriptsService.name);
  private transcriptBuffer = new Map<number, BufferMetadata>();
  private flushIntervals = new Map<number, NodeJS.Timeout>();
  private readonly FLUSH_INTERVAL = 1 * 60 * 1000; // 1 minute
  private readonly MAX_BUFFER_SIZE = 200; // Max transcripts per meeting before force flush

  // To prevent overlapping flushes:
  private processingMeetings = new Set<number>(); // Tracking Background Meetings

  constructor(
    @InjectRepository(TranscriptEntry)
    private transcriptRepository: Repository<TranscriptEntry>,
    @InjectRepository(TranscriptSegment)
    private transcriptSegmentRepository: Repository<TranscriptSegment>,
    @InjectRepository(Summary)
    private summaryRepository: Repository<Summary>,
    @Inject(forwardRef(() => GeminiService))
    private geminiService: GeminiService,
    @Inject(forwardRef(() => RAGService))
    private ragService: RAGService,
    @Inject(forwardRef(() => MeetingsService))
    private meetingsService: MeetingsService,
  ) {}

  async addTranscript(meeting: Meeting, transcriptionData: any): Promise<void> {
    const segment = this.transcriptSegmentRepository.create({
      meetingId: meeting.id,
      speakerName: transcriptionData.speaker_name,
      speakerUuid: transcriptionData.speaker_uuid,
      speakerUserUuid: transcriptionData.speaker_user_uuid,
      speakerIsHost: transcriptionData.speaker_is_host,
      transcript: transcriptionData.transcription.transcript,
      words: transcriptionData.transcription.words,
      timestampMs: transcriptionData.timestamp_ms.toString(),
      durationMs: transcriptionData.duration_ms.toString(),
    });
    this.transcriptSegmentRepository.save(segment).catch((err) => {
      this.logger.error(`Error saving transcript segment: ${err.message}`);
    });

    this.logger.log(`Queued transcript segment for meeting ${meeting.id}`);

    // Emit to frontend via SSE:
    this.meetingsService.transcriptEvents$.next({
      userId: meeting.userId,
      type: 'transcript_update',
      data: transcriptionData,
      timestamp: new Date().toISOString(),
    });

    // Add to buffer for 1-minute grouping
    if (!this.transcriptBuffer.has(meeting.id)) {
      this.logger.log(`Initializing new buffer for meeting ${meeting.id}`);
      this.transcriptBuffer.set(meeting.id, {
        transcripts: [],
        timeStart: new Date(transcriptionData.timestamp_ms).toISOString(),
      });
      this.startFlushInterval(meeting.id);
    }

    const bufferData = this.transcriptBuffer.get(meeting.id)!;
    const buffer = bufferData.transcripts;

    // Grouping takes place in RAG service. Adding buffer without merge:
    buffer.push({
      speaker_name: transcriptionData.speaker_name,
      speaker_uuid: transcriptionData.speaker_uuid,
      speaker_user_uuid: transcriptionData.speaker_user_uuid,
      speaker_is_host: transcriptionData.speaker_is_host,
      timestamp_ms: transcriptionData.timestamp_ms,
      duration_ms: transcriptionData.duration_ms,
      transcription: {
        transcript: transcriptionData.transcription.transcript,
        words: transcriptionData.transcription.words,
      },
    });

    this.logger.debug(
      `Added transcript to buffer for meeting ${meeting.id}. Buffer size: ${buffer.length}`,
    );

    // Force flush if buffer exceeds max size (bounded buffer)
    if (buffer.length >= this.MAX_BUFFER_SIZE) {
      this.logger.warn(
        `Buffer for meeting ${meeting.id} reached max size (${this.MAX_BUFFER_SIZE}), triggering force flush`,
      );
      setImmediate(() => {
        this.flushMeetingBuffer(meeting.id).catch((err) => {
          this.logger.error(`Force flush error: ${err.message}`);
        });
      });
    }
  }

  private startFlushInterval(meetingId: number): void {
    if (this.flushIntervals.has(meetingId)) {
      return;
    }
    const interval = setInterval(() => {
      this.flushMeetingBuffer(meetingId).catch((err) => {
        this.logger.error(
          `Flush interval error for meeting ${meetingId}: ${err.message}`,
        );
      });
    }, this.FLUSH_INTERVAL);
    this.flushIntervals.set(meetingId, interval);
    this.logger.log(`Started flush interval for meeting ${meetingId}`);
  }

  async flushMeetingBuffer(meetingId: number): Promise<void> {
    // Prevent overlapping flushes for the same meeting
    if (this.processingMeetings.has(meetingId)) {
      this.logger.debug(
        `Meeting ${meetingId} is already being processed, skipping flush`,
      );
      return;
    }

    const bufferData = this.transcriptBuffer.get(meetingId);
    if (!bufferData || bufferData.transcripts.length === 0) {
      this.logger.debug(`No transcripts to flush for meeting ${meetingId}`);
      return;
    }

    try {
      this.processingMeetings.add(meetingId);

      const meeting = await this.meetingsService.getMeetingById(meetingId);
      if (!meeting) {
        this.logger.warn(`Meeting ${meetingId} not found, clearing buffer`);
        this.clearMeetingBuffer(meetingId);
        return;
      }

      const transcriptsToProcess = [...bufferData.transcripts];
      const timeStart = bufferData.timeStart;
      const timeEnd = new Date().toISOString();

      // Reset buffer
      this.transcriptBuffer.set(meetingId, {
        transcripts: [],
        timeStart: timeEnd,
      });

      this.logger.log(
        `Flushing ${transcriptsToProcess.length} transcript segments for meeting ${meetingId}`,
      );

      const transcriptEntry = this.transcriptRepository.create({
        transcripts: transcriptsToProcess,
        meetingId: meetingId,
        timeStart: timeStart,
        timeEnd: timeEnd,
      });
      await this.transcriptRepository.save(transcriptEntry);

      // Process vector storage and summary generation in background
      this.processInBackground(meetingId, meeting.userId, transcriptsToProcess);
    } catch (error: any) {
      this.logger.error(
        `Error flushing transcripts for meeting ${meetingId}:`,
        error,
      );
    } finally {
      this.processingMeetings.delete(meetingId);
    }
  }

  /**
   * Process vector storage and summary generation in background
   */
  private processInBackground(
    meetingId: number,
    userId: string,
    transcripts: TranscriptData[],
  ): void {
    // Vector storage
    setImmediate(async () => {
      try {
        await this.ragService.storeTranscripts(meetingId, transcripts);
        this.logger.log(`[BACKGROUND] Stored vectors for meeting ${meetingId}`);
      } catch (err: any) {
        this.logger.error(
          `[BACKGROUND] Error storing vectors for meeting ${meetingId}: ${err.message}`,
        );
      }
    });

    // Summary generation
    setImmediate(async () => {
      try {
        await this.generateAndSaveSummary(meetingId, userId, transcripts);
      } catch (err: any) {
        this.logger.error(
          `[BACKGROUND] Error generating summary for meeting ${meetingId}: ${err.message}`,
        );
      }
    });
  }

  async flushAndClearMeeting(meetingId: number): Promise<void> {
    await this.flushMeetingBuffer(meetingId);
    this.clearMeetingBuffer(meetingId);
  }

  private async generateAndSaveSummary(
    meetingId: number,
    userId: string,
    transcripts: TranscriptData[],
  ): Promise<void> {
    try {
      this.logger.log(
        `[BACKGROUND] Generating summary for meeting ${meetingId}...`,
      );
      const summaryContent =
        await this.geminiService.generateSummary(transcripts);

      const meeting = await this.meetingsService.getMeetingById(meetingId);
      if (!meeting) {
        this.logger.warn(`Meeting ${meetingId} not found for summary`);
        return;
      }
      const summary = this.summaryRepository.create({
        content: summaryContent,
        meetingId: meetingId,
        meeting: meeting,
      });
      const savedSummary = await this.summaryRepository.save(summary);

      // Emit summary update via SSE
      this.meetingsService.summaryEvent$.next({
        userId: userId,
        type: 'summary_update',
        data: savedSummary,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `[BACKGROUND] Summary saved for meeting ${meetingId}: ${savedSummary.id}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[BACKGROUND] Error generating/saving summary for meeting ${meetingId}:`,
        error,
      );
    }
  }

  private clearMeetingBuffer(meetingId: number): void {
    const interval = this.flushIntervals.get(meetingId);
    if (interval) {
      clearInterval(interval);
      this.flushIntervals.delete(meetingId);
    }
    this.transcriptBuffer.delete(meetingId);
    this.processingMeetings.delete(meetingId);
    this.logger.log(
      `Cleared buffer and stopped flush for meeting ${meetingId}`,
    );
  }

  /**
   * Get current buffer statistics for monitoring
   */
  getBufferStats(): {
    activeMeetings: number;
    totalBufferedTranscripts: number;
    processingCount: number;
  } {
    let totalBufferedTranscripts = 0;
    this.transcriptBuffer.forEach((buffer) => {
      totalBufferedTranscripts += buffer.transcripts.length;
    });

    return {
      activeMeetings: this.transcriptBuffer.size,
      totalBufferedTranscripts,
      processingCount: this.processingMeetings.size,
    };
  }

  async onModuleDestroy() {
    this.logger.log('Flushing all buffers before shutdown...');
    const flushPromises = Array.from(this.transcriptBuffer.keys()).map(
      (meetingId) => this.flushMeetingBuffer(meetingId),
    );
    await Promise.all(flushPromises);
    this.flushIntervals.forEach((interval) => clearInterval(interval));
    this.flushIntervals.clear();
    this.transcriptBuffer.clear();
    this.processingMeetings.clear();
    this.logger.log('Transcript buffer service shutdown complete');
  }
}

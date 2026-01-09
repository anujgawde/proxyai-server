import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TranscriptEntry,
  TranscriptData,
} from 'src/entities/transcript-entry.entity';
import { TranscriptSegment } from 'src/entities/transcript-segment.entity';
import { Meeting } from 'src/entities/meeting.entity';
import { GeminiService } from 'src/gemini/gemini.service';
import { Summary } from 'src/entities/summary.entity';
import { RAGService } from 'src/rag/rag.service';
import { MeetingsService } from 'src/meetings/meetings.service';
import { JobProcessorService, TranscriptJob } from 'src/services/job-processor.service';

interface BufferMetadata {
  transcripts: TranscriptData[];
  timeStart: string;
}

@Injectable()
export class TranscriptsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptsService.name);
  private transcriptBuffer = new Map<number, BufferMetadata>();
  private flushIntervals = new Map<number, NodeJS.Timeout>();
  private readonly FLUSH_INTERVAL = 1 * 60 * 1000;

  // Buffer limits for free tier optimization
  private readonly MAX_BUFFER_SIZE = 200; // Maximum segments per buffer
  private readonly MAX_BUFFER_AGE = 2 * 60 * 1000; // 2 minutes max buffer age
  private readonly MAX_CONCURRENT_MEETINGS = 100; // Hard limit on concurrent meetings

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
    private jobProcessor: JobProcessorService,
  ) {}

  async onModuleInit() {
    this.logger.log('Registering transcript processor callback with JobProcessorService');
    this.jobProcessor.setTranscriptProcessor(async (job: TranscriptJob) => {
      await this.processBufferFlush(job);
    });
  }

  async addTranscript(meeting: Meeting, transcriptionData: any): Promise<void> {
    // Save individual segment to database immediately
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

    await this.transcriptSegmentRepository.save(segment);

    this.logger.log(
      `Saved transcript segment ${segment.id} for meeting ${meeting.id}`,
    );

    // Emit to frontend via SSE immediately
    this.meetingsService.transcriptEvents$.next({
      userId: meeting.userId,
      type: 'transcript_update',
      data: transcriptionData,
      timestamp: new Date().toISOString(),
    });

    // Add to buffer for 1-minute grouping
    if (!this.transcriptBuffer.has(meeting.id)) {
      // Enforce maximum concurrent meetings limit
      if (this.transcriptBuffer.size >= this.MAX_CONCURRENT_MEETINGS) {
        this.logger.warn(
          `Maximum concurrent meetings limit (${this.MAX_CONCURRENT_MEETINGS}) reached. Cannot create buffer for meeting ${meeting.id}`,
        );
        return;
      }

      this.logger.log(`Initializing new buffer for meeting ${meeting.id}`);
      this.transcriptBuffer.set(meeting.id, {
        transcripts: [],
        timeStart: new Date(transcriptionData.timestamp_ms).toISOString(),
      });
      this.startFlushInterval(meeting.id);
    }

    const bufferData = this.transcriptBuffer.get(meeting.id)!;
    const buffer = bufferData.transcripts;

    // Check buffer size limit before adding
    if (buffer.length >= this.MAX_BUFFER_SIZE) {
      this.logger.warn(
        `Buffer for meeting ${meeting.id} reached max size (${this.MAX_BUFFER_SIZE}). Flushing immediately.`,
      );
      await this.flushMeetingBuffer(meeting.id);
      // Re-get buffer after flush
      const newBufferData = this.transcriptBuffer.get(meeting.id);
      if (!newBufferData) {
        this.logger.error(
          `Buffer for meeting ${meeting.id} not found after flush`,
        );
        return;
      }
    }

    // Check buffer age and flush if too old
    const bufferAge = Date.now() - new Date(bufferData.timeStart).getTime();
    if (bufferAge >= this.MAX_BUFFER_AGE) {
      this.logger.warn(
        `Buffer for meeting ${meeting.id} exceeded max age (${this.MAX_BUFFER_AGE}ms). Flushing immediately.`,
      );
      await this.flushMeetingBuffer(meeting.id);
      // Re-get buffer after flush
      const newBufferData = this.transcriptBuffer.get(meeting.id);
      if (!newBufferData) {
        this.logger.error(
          `Buffer for meeting ${meeting.id} not found after flush`,
        );
        return;
      }
    }

    // Add to buffer without merging (let RAG service handle grouping)
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
  }

  private startFlushInterval(meetingId: number): void {
    if (this.flushIntervals.has(meetingId)) {
      return;
    }
    const interval = setInterval(async () => {
      await this.flushMeetingBuffer(meetingId);
    }, this.FLUSH_INTERVAL);
    this.flushIntervals.set(meetingId, interval);
    this.logger.log(`Started flush interval for meeting ${meetingId}`);
  }

  async flushMeetingBuffer(meetingId: number): Promise<void> {
    const bufferData = this.transcriptBuffer.get(meetingId);
    if (!bufferData || bufferData.transcripts.length === 0) {
      this.logger.debug(`No transcripts to flush for meeting ${meetingId}`);
      return;
    }

    try {
      const meeting = await this.meetingsService.getMeetingById(meetingId);
      if (!meeting) {
        this.logger.warn(`Meeting ${meetingId} not found, clearing buffer`);
        this.clearMeetingBuffer(meetingId);
        return;
      }

      const transcriptsToProcess = [...bufferData.transcripts];
      const timeStart = bufferData.timeStart;
      const timeEnd = new Date().toISOString();

      // Get segment IDs from the buffer
      const segmentIds = transcriptsToProcess.map((t) => t.timestamp_ms);

      // Reset buffer immediately (before enqueueing to allow new segments)
      this.transcriptBuffer.set(meetingId, {
        transcripts: [],
        timeStart: timeEnd,
      });

      // Enqueue job for async processing
      await this.jobProcessor.addTranscriptProcessingJob({
        meetingId: meetingId,
        segmentIds: segmentIds,
        timeStart: timeStart,
        timeEnd: timeEnd,
      });

      this.logger.log(
        `Enqueued processing job for ${transcriptsToProcess.length} transcript segments for meeting ${meetingId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error flushing transcripts for meeting ${meetingId}:`,
        error,
      );
    }
  }

  /**
   * Process transcript buffer flush job (called by JobProcessorService worker)
   */
  private async processBufferFlush(job: TranscriptJob): Promise<void> {
    const { meetingId, timeStart, timeEnd } = job;

    this.logger.log(
      `Processing transcript flush job for meeting ${meetingId}`,
    );

    try {
      const meeting = await this.meetingsService.getMeetingById(meetingId);
      if (!meeting) {
        this.logger.warn(`Meeting ${meetingId} not found during job processing`);
        return;
      }

      // Fetch segments from database (they were already saved in addTranscript)
      const segments = await this.transcriptSegmentRepository.find({
        where: {
          meetingId: meetingId,
        },
        order: {
          timestampMs: 'ASC',
        },
      });

      if (segments.length === 0) {
        this.logger.warn(`No segments found for meeting ${meetingId}`);
        return;
      }

      // Convert segments to TranscriptData format
      const transcriptsToProcess: TranscriptData[] = segments.map((seg) => ({
        speaker_name: seg.speakerName,
        speaker_uuid: seg.speakerUuid,
        speaker_user_uuid: seg.speakerUserUuid,
        speaker_is_host: seg.speakerIsHost,
        timestamp_ms: parseInt(seg.timestampMs),
        duration_ms: seg.durationMs,
        transcription: {
          transcript: seg.transcript,
          words: seg.words,
        },
      }));

      // Group transcripts by speaker for Qdrant (call RAG's chunking)
      const groupedChunks =
        this.ragService.chunkTranscriptsForContext(transcriptsToProcess);

      // Save grouped chunks to TranscriptEntry
      const transcriptEntry = this.transcriptRepository.create({
        transcripts: transcriptsToProcess,
        meetingId: meetingId,
        timeStart: timeStart,
        timeEnd: timeEnd,
      });
      await this.transcriptRepository.save(transcriptEntry);

      this.logger.log(
        `Saved ${transcriptsToProcess.length} transcript segments (${groupedChunks.length} grouped chunks) for meeting ${meetingId}`,
      );

      // Store grouped chunks in Qdrant vector database
      try {
        await this.ragService.storeTranscripts(meetingId, transcriptsToProcess);
        this.logger.log(
          `Stored ${groupedChunks.length} grouped chunks in vector database for meeting ${meetingId}`,
        );
      } catch (ragError) {
        this.logger.error(
          `Error storing transcripts in vector database: ${ragError.message}`,
        );
        // Don't throw - continue with summary generation even if vector storage fails
      }

      // Generate summary from buffer
      await this.generateAndSaveSummary(meeting.id, transcriptsToProcess);
    } catch (error) {
      this.logger.error(
        `Error processing transcript flush job for meeting ${meetingId}:`,
        error,
      );
      throw error; // Re-throw to trigger BullMQ retry
    }
  }

  async flushAndClearMeeting(meetingId: number): Promise<void> {
    await this.flushMeetingBuffer(meetingId);
    this.clearMeetingBuffer(meetingId);
  }

  private async generateAndSaveSummary(
    meetingId: number,
    transcripts: TranscriptData[],
  ): Promise<void> {
    try {
      this.logger.log(`Generating summary for meeting ${meetingId}...`);
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
      this.meetingsService.summaryEvent$.next({
        userId: meeting.userId,
        type: 'summary_update',
        data: savedSummary,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `Summary saved for meeting ${meetingId}: ${savedSummary.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Error generating/saving summary for meeting ${meetingId}:`,
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
    this.logger.log(
      `Cleared buffer and stopped flush for meeting ${meetingId}`,
    );
  }

  // getBufferStatus(meetingId: string): {
  //   bufferSize: number;
  //   transcripts: TranscriptData[];
  //   timeStart: string;
  //   timeElapsed: number;
  // } | null {
  //   const bufferData = this.transcriptBuffer.get(meetingId);

  //   if (!bufferData) {
  //     return null;
  //   }

  //   const timeElapsed =
  //     new Date().getTime() - new Date(bufferData.timeStart).getTime();

  //   return {
  //     bufferSize: bufferData.transcripts.length,
  //     transcripts: bufferData.transcripts,
  //     timeStart: bufferData.timeStart,
  //     timeElapsed,
  //   };
  // }

  async onModuleDestroy() {
    this.logger.log('Flushing all buffers before shutdown...');
    const flushPromises = Array.from(this.transcriptBuffer.keys()).map(
      (meetingId) => this.flushMeetingBuffer(meetingId),
    );
    await Promise.all(flushPromises);
    this.flushIntervals.forEach((interval) => clearInterval(interval));
    this.flushIntervals.clear();
    this.transcriptBuffer.clear();
    this.logger.log('Transcript buffer service shutdown complete');
  }
}

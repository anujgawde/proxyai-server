// src/meetings/transcripts.service.ts
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
import { MeetingsGateway } from 'src/meetings/meetings.gateway';

interface BufferMetadata {
  transcripts: TranscriptData[];
  timeStart: string;
}

@Injectable()
export class TranscriptsService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscriptsService.name);
  private transcriptBuffer = new Map<string, BufferMetadata>();
  private flushIntervals = new Map<string, NodeJS.Timeout>();
  private readonly FLUSH_INTERVAL = 1 * 60 * 1000;

  constructor(
    @InjectRepository(TranscriptEntry)
    private transcriptRepository: Repository<TranscriptEntry>,
    @InjectRepository(Meeting)
    private meetingsRepository: Repository<Meeting>,
    @Inject(forwardRef(() => MeetingsGateway)) // 🔥 Add forwardRef here
    private gateway: MeetingsGateway,
  ) {}

  addTranscript(
    meetingId: string,
    speakerEmail: string,
    speakerName: string,
    text: string,
  ): void {
    const currentTimeISO = new Date().toISOString();

    if (!this.transcriptBuffer.has(meetingId)) {
      this.logger.log(
        `Initializing new buffer for meeting ${meetingId} at ${currentTimeISO}`,
      );
      this.transcriptBuffer.set(meetingId, {
        transcripts: [],
        timeStart: currentTimeISO,
      });
      this.startFlushInterval(meetingId);
    }

    const bufferData = this.transcriptBuffer.get(meetingId)!;
    const buffer = bufferData.transcripts;

    const lastEntry = buffer[buffer.length - 1];

    if (lastEntry && lastEntry.speakerEmail === speakerEmail) {
      const lastTimestamp = new Date(lastEntry.timestamp);
      const currentTime = new Date(currentTimeISO);
      const timeDiff = currentTime.getTime() - lastTimestamp.getTime();

      if (timeDiff < 5000) {
        lastEntry.text += ' ' + text;
        lastEntry.timestamp = currentTimeISO;
        this.logger.debug(
          `Merged transcript for ${speakerEmail} in meeting ${meetingId}`,
        );
        return;
      }
    }

    buffer.push({
      speakerEmail,
      speakerName,
      text: text.trim(),
      timestamp: currentTimeISO,
    });

    this.logger.debug(
      `Added transcript to buffer for meeting ${meetingId}. Buffer size: ${buffer.length}`,
    );
  }

  private startFlushInterval(meetingId: string): void {
    if (this.flushIntervals.has(meetingId)) {
      return;
    }

    const interval = setInterval(async () => {
      await this.flushMeetingBuffer(meetingId);
    }, this.FLUSH_INTERVAL);

    this.flushIntervals.set(meetingId, interval);
    this.logger.log(`Started flush interval for meeting ${meetingId}`);
  }

  async flushMeetingBuffer(meetingId: string): Promise<void> {
    const bufferData = this.transcriptBuffer.get(meetingId);

    if (!bufferData || bufferData.transcripts.length === 0) {
      this.logger.debug(`No transcripts to flush for meeting ${meetingId}`);
      return;
    }

    try {
      const meeting = await this.meetingsRepository.findOne({
        where: { id: meetingId },
      });

      if (!meeting) {
        this.logger.warn(`Meeting ${meetingId} not found, clearing buffer`);
        this.clearMeetingBuffer(meetingId);
        return;
      }

      const transcriptsToSave = [...bufferData.transcripts];
      const timeStart = bufferData.timeStart;
      const timeEnd = new Date().toISOString();

      this.transcriptBuffer.set(meetingId, {
        transcripts: [],
        timeStart: timeEnd,
      });

      const transcriptEntry = this.transcriptRepository.create({
        transcripts: transcriptsToSave,
        meetingId: meetingId,
        timeStart: timeStart,
        timeEnd: timeEnd,
      });

      const savedEntry = await this.transcriptRepository.save(transcriptEntry);

      this.logger.log(
        `Flushed ${transcriptsToSave.length} transcript segments for meeting ${meetingId}. Time range: ${timeStart} - ${timeEnd}`,
      );

      // Broadcast flushed transcripts
      if (this.gateway) {
        this.gateway.broadcastTranscriptsFlushed(meetingId, {
          entryId: savedEntry.id,
          transcripts: transcriptsToSave,
          timeStart: timeStart,
          timeEnd: timeEnd,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error flushing transcripts for meeting ${meetingId}:`,
        error,
      );
    }
  }

  async flushAndClearMeeting(meetingId: string): Promise<void> {
    await this.flushMeetingBuffer(meetingId);
    this.clearMeetingBuffer(meetingId);
  }

  private clearMeetingBuffer(meetingId: string): void {
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

  getBufferStatus(meetingId: string): {
    bufferSize: number;
    transcripts: TranscriptData[];
    timeStart: string;
    timeElapsed: number;
  } | null {
    const bufferData = this.transcriptBuffer.get(meetingId);

    if (!bufferData) {
      return null;
    }

    const timeElapsed =
      new Date().getTime() - new Date(bufferData.timeStart).getTime();

    return {
      bufferSize: bufferData.transcripts.length,
      transcripts: bufferData.transcripts,
      timeStart: bufferData.timeStart,
      timeElapsed,
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

    this.logger.log('Transcript buffer service shutdown complete');
  }
}

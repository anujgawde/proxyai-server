import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Meeting, MeetingStatus } from '../../entities/meeting.entity';
import { IMeetingState } from './meeting-state.interface';
import { TranscriptsService } from '../../transcripts/transcripts.service';

/**
 * Past State
 *
 * Represents a meeting that has ended.
 * This is a terminal state - no valid transitions.
 */
@Injectable()
export class PastState implements IMeetingState {
  private readonly logger = new Logger(PastState.name);

  readonly status = MeetingStatus.PAST;

  /**
   * PAST is a terminal state - no valid transitions
   */
  private readonly validTransitions: MeetingStatus[] = [];

  constructor(
    @Inject(forwardRef(() => TranscriptsService))
    private readonly transcriptsService: TranscriptsService,
  ) {}

  canTransitionTo(target: MeetingStatus): boolean {
    return this.validTransitions.includes(target);
  }

  getValidTransitions(): MeetingStatus[] {
    return [...this.validTransitions];
  }

  async onEnter(meeting: Meeting): Promise<void> {
    this.logger.log(`Meeting ${meeting.id} transitioned to PAST`);

    // Flush any remaining transcript buffer
    try {
      await this.transcriptsService.flushAndClearMeeting(meeting.id);
      this.logger.log(`Flushed transcript buffer for meeting ${meeting.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to flush transcripts for meeting ${meeting.id}:`,
        error,
      );
    }
  }

  async onExit(meeting: Meeting): Promise<void> {
    // PAST is terminal, this should never be called
    this.logger.warn(
      `Unexpected exit from PAST state for meeting ${meeting.id}`,
    );
  }
}

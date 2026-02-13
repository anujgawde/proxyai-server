import { Injectable, Logger } from '@nestjs/common';
import { Meeting, MeetingStatus } from '../../entities/meeting.entity';
import { IMeetingState } from './meeting-state.interface';

/**
 * Live State
 *
 * Represents a meeting that is currently in progress.
 * Valid transitions: PAST
 */
@Injectable()
export class LiveState implements IMeetingState {
  private readonly logger = new Logger(LiveState.name);

  readonly status = MeetingStatus.LIVE;

  /**
   * Valid transitions from LIVE:
   * - PAST: Meeting has ended
   */
  private readonly validTransitions: MeetingStatus[] = [MeetingStatus.PAST];

  canTransitionTo(target: MeetingStatus): boolean {
    return this.validTransitions.includes(target);
  }

  getValidTransitions(): MeetingStatus[] {
    return [...this.validTransitions];
  }

  async onEnter(meeting: Meeting): Promise<void> {
    this.logger.log(`Meeting ${meeting.id} is now LIVE`);
    // Could trigger notifications, start recording, etc.
  }

  async onExit(meeting: Meeting): Promise<void> {
    this.logger.log(`Meeting ${meeting.id} ending LIVE session`);
    // Actions when meeting stops being live are handled in PAST.onEnter
  }
}

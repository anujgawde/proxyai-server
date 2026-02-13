import { Injectable, Logger } from '@nestjs/common';
import { Meeting, MeetingStatus } from '../../entities/meeting.entity';
import { IMeetingState } from './meeting-state.interface';

/**
 * Scheduled State
 *
 * Represents a meeting that has been created but not yet started.
 * Valid transitions: LIVE, CANCELLED, NO_SHOW
 */
@Injectable()
export class ScheduledState implements IMeetingState {
  private readonly logger = new Logger(ScheduledState.name);

  readonly status = MeetingStatus.SCHEDULED;

  /**
   * Valid transitions from SCHEDULED:
   * - LIVE: Meeting has started
   * - CANCELLED: Meeting was cancelled
   * - NO_SHOW: Meeting time passed without anyone joining
   */
  private readonly validTransitions: MeetingStatus[] = [
    MeetingStatus.LIVE,
    MeetingStatus.CANCELLED,
    MeetingStatus.NO_SHOW,
  ];

  canTransitionTo(target: MeetingStatus): boolean {
    return this.validTransitions.includes(target);
  }

  getValidTransitions(): MeetingStatus[] {
    return [...this.validTransitions];
  }

  async onEnter(meeting: Meeting): Promise<void> {
    this.logger.debug(`Meeting ${meeting.id} entered SCHEDULED state`);
    // No specific actions needed when entering scheduled state
  }

  async onExit(meeting: Meeting): Promise<void> {
    this.logger.debug(`Meeting ${meeting.id} exiting SCHEDULED state`);
    // No specific actions needed when exiting scheduled state
  }
}

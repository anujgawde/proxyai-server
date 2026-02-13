import { Injectable, Logger } from '@nestjs/common';
import { Meeting, MeetingStatus } from '../../entities/meeting.entity';
import {
  IMeetingState,
  BOT_STATE_TO_MEETING_STATUS,
  StateTransitionResult,
} from './meeting-state.interface';
import { ScheduledState } from './scheduled.state';
import { LiveState } from './live.state';
import { PastState } from './past.state';

/**
 * Meeting State Machine
 *
 * Manages meeting state transitions with validation.
 * Ensures only valid transitions occur and triggers
 * appropriate actions on state entry/exit.
 */
@Injectable()
export class MeetingStateMachine {
  private readonly logger = new Logger(MeetingStateMachine.name);
  private readonly states = new Map<MeetingStatus, IMeetingState>();

  constructor(
    private readonly scheduledState: ScheduledState,
    private readonly liveState: LiveState,
    private readonly pastState: PastState,
  ) {
    // Register all states
    this.states.set(MeetingStatus.SCHEDULED, scheduledState);
    this.states.set(MeetingStatus.LIVE, liveState);
    this.states.set(MeetingStatus.PAST, pastState);
  }

  /**
   * Get the state handler for a given status
   */
  getState(status: MeetingStatus): IMeetingState | undefined {
    return this.states.get(status);
  }

  /**
   * Check if a transition is valid
   */
  canTransition(from: MeetingStatus, to: MeetingStatus): boolean {
    const currentState = this.states.get(from);
    if (!currentState) {
      this.logger.warn(`Unknown state: ${from}`);
      return false;
    }
    return currentState.canTransitionTo(to);
  }

  /**
   * Get valid transitions from a status
   */
  getValidTransitions(from: MeetingStatus): MeetingStatus[] {
    const state = this.states.get(from);
    return state ? state.getValidTransitions() : [];
  }

  /**
   * Transition a meeting to a new state
   */
  async transition(
    meeting: Meeting,
    targetStatus: MeetingStatus,
  ): Promise<StateTransitionResult> {
    const previousStatus = meeting.status;

    // Check if already in target state
    if (previousStatus === targetStatus) {
      return {
        success: true,
        previousStatus,
        newStatus: targetStatus,
      };
    }

    // Validate transition
    if (!this.canTransition(previousStatus, targetStatus)) {
      const error = `Invalid transition from ${previousStatus} to ${targetStatus}`;
      this.logger.warn(`Meeting ${meeting.id}: ${error}`);
      return {
        success: false,
        previousStatus,
        newStatus: previousStatus,
        error,
      };
    }

    const currentState = this.states.get(previousStatus);
    const targetState = this.states.get(targetStatus);

    try {
      // Exit current state
      if (currentState) {
        await currentState.onExit(meeting);
      }

      // Update meeting status
      meeting.status = targetStatus;

      // Enter new state
      if (targetState) {
        await targetState.onEnter(meeting);
      }

      this.logger.log(
        `Meeting ${meeting.id} transitioned: ${previousStatus} to ${targetStatus}`,
      );

      return {
        success: true,
        previousStatus,
        newStatus: targetStatus,
      };
    } catch (error) {
      this.logger.error(
        `Failed to transition meeting ${meeting.id} from ${previousStatus} to ${targetStatus}:`,
        error,
      );

      // Revert status on failure
      meeting.status = previousStatus;

      return {
        success: false,
        previousStatus,
        newStatus: previousStatus,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Transition based on bot state
   */
  async transitionFromBotState(
    meeting: Meeting,
    botState: string,
  ): Promise<StateTransitionResult> {
    const targetStatus = BOT_STATE_TO_MEETING_STATUS[botState];

    if (!targetStatus) {
      return {
        success: false,
        previousStatus: meeting.status,
        newStatus: meeting.status,
        error: `Unknown bot state: ${botState}`,
      };
    }

    return this.transition(meeting, targetStatus);
  }
}

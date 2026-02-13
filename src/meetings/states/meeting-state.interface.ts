import { Meeting, MeetingStatus } from '../../entities/meeting.entity';

/**
 * Meeting State Interface
 *
 * Each state implementation handles:
 * - Valid transitions from this state
 * - Actions to perform when entering/exiting the state
 * - State-specific behavior
 */
export interface IMeetingState {
  /**
   * The status this state represents
   */
  readonly status: MeetingStatus;

  /**
   * Check if transition to target state is valid
   */
  canTransitionTo(target: MeetingStatus): boolean;

  /**
   * Get list of valid transitions from this state
   */
  getValidTransitions(): MeetingStatus[];

  /**
   * Actions to perform when entering this state
   */
  onEnter(meeting: Meeting): Promise<void>;

  /**
   * Actions to perform when exiting this state
   */
  onExit(meeting: Meeting): Promise<void>;
}

/**
 * Bot state to meeting status mapping
 */
export const BOT_STATE_TO_MEETING_STATUS: Record<
  string,
  MeetingStatus | undefined
> = {
  // Bot is joining/in the meeting to LIVE
  joining: MeetingStatus.LIVE,
  joined_not_recording: MeetingStatus.LIVE,
  joined_recording: MeetingStatus.LIVE,

  // Bot has left or meeting ended to PAST
  post_processing: MeetingStatus.PAST,
  ended: MeetingStatus.PAST,
  left: MeetingStatus.PAST,
  fatal_error: MeetingStatus.PAST,
};

/**
 * Context for state transitions
 */
export interface StateTransitionContext {
  meeting: Meeting;
  botState?: string;
  reason?: string;
}

/**
 * Result of a state transition
 */
export interface StateTransitionResult {
  success: boolean;
  previousStatus: MeetingStatus;
  newStatus: MeetingStatus;
  error?: string;
}

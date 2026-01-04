export interface ScheduleBotParams {
  meetingUrl: string;
  startTime: Date;
  botName?: string;
}

export enum BotRecordingState {
  not_started = 'not_started',
  in_progress = 'in_progress',
  complete = 'complete',
  failed = 'failed',
  paused = 'paused',
}

export enum BotState {
  ready = 'ready',
  joining = 'joining',
  joined_not_recording = 'joined_not_recording',
  joined_recording = 'joined_recording',
  leaving = 'leaving',
  post_processing = 'post_processing',
  fatal_error = 'fatal_error',
  waiting_room = 'waiting_room',
  ended = 'ended',
  data_deleted = 'data_deleted',
  scheduled = 'scheduled',
  staged = 'staged',
  joined_recording_paused = 'joined_recording_paused',
  joining_breakout_room = 'joining_breakout_room',
  leaving_breakout_room = 'leaving_breakout_room',
  joined_recording_permission_denied = 'joined_recording_permission_denied',
}

export enum BotTranscriptionState {
  not_started = 'not_started',
  in_progress = 'in_progress',
  complete = 'complete',
  failed = 'failed',
}
export interface ScheduledBot {
  deduplication_key: string;
  events: Object[];
  id: string;
  join_at: string;
  meeting_url: string;
  metadata: Object;
  recording_state: BotRecordingState;
  state: BotState;
  transcription_state: BotTranscriptionState;
}

export class BotStateTriggerData {
  new_state: string;
  old_state: string;
  created_at: string;
  event_type: string;
  event_sub_type: string;
}

export class TranscriptUpdateTriggerData {}

export class BotWebhookDto {
  idempotency_key: string;
  bot_id: string;
  bot_metadata: any;
  trigger:
    | 'bot.state_change'
    | 'transcript.update'
    | 'chat_messages.update'
    | 'participant_events.join_leave';
  data: BotStateTriggerData | TranscriptUpdateTriggerData;
}

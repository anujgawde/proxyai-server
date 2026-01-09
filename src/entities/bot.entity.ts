import { IsString, IsNotEmpty, IsIn, IsObject, IsOptional } from 'class-validator';

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
  events: object[];
  id: string;
  join_at: string;
  meeting_url: string;
  metadata: object;
  recording_state: BotRecordingState;
  state: BotState;
  transcription_state: BotTranscriptionState;
}

export class BotStateTriggerData {
  @IsString()
  @IsNotEmpty()
  new_state: string;

  @IsString()
  @IsNotEmpty()
  old_state: string;

  @IsString()
  @IsNotEmpty()
  created_at: string;

  @IsString()
  @IsNotEmpty()
  event_type: string;

  @IsString()
  @IsNotEmpty()
  event_sub_type: string;
}

export class TranscriptUpdateTriggerData {
  @IsOptional()
  @IsObject()
  data?: any;
}

export class BotWebhookDto {
  @IsString()
  @IsNotEmpty()
  idempotency_key: string;

  @IsString()
  @IsNotEmpty()
  bot_id: string;

  @IsOptional()
  @IsObject()
  bot_metadata: any;

  @IsString()
  @IsIn([
    'bot.state_change',
    'transcript.update',
    'chat_messages.update',
    'participant_events.join_leave',
  ])
  trigger:
    | 'bot.state_change'
    | 'transcript.update'
    | 'chat_messages.update'
    | 'participant_events.join_leave';

  @IsObject()
  @IsNotEmpty()
  data: BotStateTriggerData | TranscriptUpdateTriggerData;
}

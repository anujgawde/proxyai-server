import { Injectable, Logger } from '@nestjs/common';
import { filter, merge, Observable, Subject, interval, map } from 'rxjs';
import { MeetingStatus } from '../../entities/meeting.entity';
import { Summary } from '../../entities/summary.entity';

/**
 * Event types for real-time meeting updates
 */
export interface MeetingEvent {
  userId: string;
  type: 'connected' | 'heartbeat' | 'meeting_status_update';
  data?: {
    id: number;
    status: MeetingStatus;
  };
  message?: string;
  timestamp: string;
}

export interface TranscriptEvent {
  userId: string;
  type: 'connected' | 'heartbeat' | 'transcript_update';
  data?: {
    speaker_name: string;
    speaker_uuid: string;
    speaker_user_uuid: string;
    speaker_is_host: boolean;
    timestamp_ms: number;
    duration_ms: number;
    transcription: {
      transcript: string;
      words: number;
    };
  };
  message?: string;
  timestamp: string;
}

export interface SummaryEvent {
  userId: string;
  type: 'connected' | 'heartbeat' | 'summary_update';
  data?: Summary;
  message?: string;
  timestamp: string;
}

/**
 * Meeting Stream Service
 *
 * Handles all real-time event streaming for meetings:
 * - SSE connection management
 * - Meeting status updates
 * - Transcript updates
 * - Summary updates
 */
@Injectable()
export class MeetingStreamService {
  private readonly logger = new Logger(MeetingStreamService.name);

  // Event subjects for different event types
  private readonly meetingEvents$ = new Subject<MeetingEvent>();
  private readonly transcriptEvents$ = new Subject<TranscriptEvent>();
  private readonly summaryEvents$ = new Subject<SummaryEvent>();

  // Heartbeat interval in milliseconds
  private readonly HEARTBEAT_INTERVAL_MS = 15000;

  /**
   * Get an observable stream of all meeting-related events for a user
   *
   * @param userId The user's Firebase UID
   * @returns Observable that emits SSE-formatted events
   */
  getUserMeetingStream(userId: string): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      this.logger.debug(`SSE connection opened for user: ${userId}`);

      // Send initial connection success message
      subscriber.next({
        data: JSON.stringify({
          type: 'connected',
          message: 'SSE connection established',
          timestamp: new Date().toISOString(),
        }),
      });

      // Create heartbeat stream
      const heartbeat$ = interval(this.HEARTBEAT_INTERVAL_MS).pipe(
        map(() => ({
          data: JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          }),
        })),
      );

      // Create event streams filtered by userId
      const userMeetingEvents$ = this.meetingEvents$.pipe(
        filter((e) => e.userId === userId),
        map((event) => ({ data: JSON.stringify(event) })),
      );

      const userTranscriptEvents$ = this.transcriptEvents$.pipe(
        filter((e) => e.userId === userId),
        map((event) => ({ data: JSON.stringify(event) })),
      );

      const userSummaryEvents$ = this.summaryEvents$.pipe(
        filter((e) => e.userId === userId),
        map((event) => ({ data: JSON.stringify(event) })),
      );

      // Merge all streams
      const subscription = merge(
        heartbeat$,
        userMeetingEvents$,
        userTranscriptEvents$,
        userSummaryEvents$,
      ).subscribe(subscriber);

      // Cleanup on disconnect
      return () => {
        this.logger.debug(`SSE connection closed for user: ${userId}`);
        subscription.unsubscribe();
      };
    });
  }

  /**
   * Emit a meeting status update event
   */
  emitMeetingStatusUpdate(
    userId: string,
    meetingId: number,
    status: MeetingStatus,
  ): void {
    this.meetingEvents$.next({
      userId,
      type: 'meeting_status_update',
      data: {
        id: meetingId,
        status,
      },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit a transcript update event
   */
  emitTranscriptUpdate(userId: string, transcriptData: any): void {
    this.transcriptEvents$.next({
      userId,
      type: 'transcript_update',
      data: transcriptData,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit a summary update event
   */
  emitSummaryUpdate(userId: string, summary: Summary): void {
    this.summaryEvents$.next({
      userId,
      type: 'summary_update',
      data: summary,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get direct access to event subjects (for backward compatibility)
   * @deprecated Use emit* methods instead
   */
  get meetingEventsSubject(): Subject<MeetingEvent> {
    return this.meetingEvents$;
  }

  get transcriptEventsSubject(): Subject<TranscriptEvent> {
    return this.transcriptEvents$;
  }

  get summaryEventsSubject(): Subject<SummaryEvent> {
    return this.summaryEvents$;
  }
}

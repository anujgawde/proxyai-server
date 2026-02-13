import { firstValueFrom, take, toArray } from 'rxjs';
import { MeetingStreamService } from './meeting-stream.service';
import { MeetingStatus } from '../../entities/meeting.entity';
import { Summary } from '../../entities/summary.entity';

describe('MeetingStreamService', () => {
  let service: MeetingStreamService;

  beforeEach(() => {
    service = new MeetingStreamService();
  });

  it('should emit a "connected" message as the first event', async () => {
    const stream$ = service.getUserMeetingStream('user-1');
    const first = await firstValueFrom(stream$);
    const parsed = JSON.parse(first.data);

    expect(parsed.type).toBe('connected');
    expect(parsed.message).toBe('SSE connection established');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should emit meeting status updates filtered by userId', async () => {
    const stream$ = service.getUserMeetingStream('user-1');

    // Collect the connected message + 1 meeting event = 2 emissions
    const collected = firstValueFrom(stream$.pipe(take(2), toArray()));

    // Emit for the correct user
    service.emitMeetingStatusUpdate('user-1', 10, MeetingStatus.LIVE);

    const events = await collected;
    expect(events).toHaveLength(2);

    const meetingEvent = JSON.parse(events[1].data);
    expect(meetingEvent.type).toBe('meeting_status_update');
    expect(meetingEvent.data).toEqual({ id: 10, status: MeetingStatus.LIVE });
    expect(meetingEvent.userId).toBe('user-1');
  });

  it('should NOT deliver events intended for a different user', async () => {
    const stream$ = service.getUserMeetingStream('user-1');

    // We expect only the connected message; the event for user-2 should be filtered out.
    const collected = firstValueFrom(stream$.pipe(take(1), toArray()));

    // Emit for a different user
    service.emitMeetingStatusUpdate('user-2', 20, MeetingStatus.PAST);

    const events = await collected;
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).type).toBe('connected');
  });

  it('should emit transcript updates for the correct user', async () => {
    const stream$ = service.getUserMeetingStream('user-1');

    const collected = firstValueFrom(stream$.pipe(take(2), toArray()));

    const transcriptData = {
      speaker_name: 'Alice',
      speaker_uuid: 'sp-1',
      speaker_user_uuid: 'su-1',
      speaker_is_host: true,
      timestamp_ms: 1000,
      duration_ms: 500,
      transcription: { transcript: 'Hello world', words: 2 },
    };

    service.emitTranscriptUpdate('user-1', transcriptData);

    const events = await collected;
    const transcriptEvent = JSON.parse(events[1].data);
    expect(transcriptEvent.type).toBe('transcript_update');
    expect(transcriptEvent.data).toEqual(transcriptData);
  });

  it('should emit summary updates for the correct user', async () => {
    const stream$ = service.getUserMeetingStream('user-1');

    const collected = firstValueFrom(stream$.pipe(take(2), toArray()));

    const summary = {
      id: 1,
      content: 'Meeting summary content',
      meetingId: 10,
    } as Summary;

    service.emitSummaryUpdate('user-1', summary);

    const events = await collected;
    const summaryEvent = JSON.parse(events[1].data);
    expect(summaryEvent.type).toBe('summary_update');
    expect(summaryEvent.data).toEqual(
      expect.objectContaining({ content: 'Meeting summary content' }),
    );
  });

  it('should merge multiple event types into the same stream', async () => {
    const stream$ = service.getUserMeetingStream('user-1');

    // connected + meeting + transcript + summary = 4
    const collected = firstValueFrom(stream$.pipe(take(4), toArray()));

    service.emitMeetingStatusUpdate('user-1', 1, MeetingStatus.LIVE);
    service.emitTranscriptUpdate('user-1', { transcript: 'hi' });
    service.emitSummaryUpdate('user-1', { content: 'summary' } as Summary);

    const events = await collected;
    expect(events).toHaveLength(4);

    const types = events.map((e) => JSON.parse(e.data).type);
    expect(types).toContain('connected');
    expect(types).toContain('meeting_status_update');
    expect(types).toContain('transcript_update');
    expect(types).toContain('summary_update');
  });

  it('should expose event subjects via deprecated getters', () => {
    expect(service.meetingEventsSubject).toBeDefined();
    expect(service.transcriptEventsSubject).toBeDefined();
    expect(service.summaryEventsSubject).toBeDefined();
  });

  it('should clean up subscription when the observable is unsubscribed', () => {
    const stream$ = service.getUserMeetingStream('user-1');
    const subscription = stream$.subscribe();

    // Should not throw
    subscription.unsubscribe();

    // After unsubscribe, emitting should not cause errors
    expect(() =>
      service.emitMeetingStatusUpdate('user-1', 1, MeetingStatus.LIVE),
    ).not.toThrow();
  });
});

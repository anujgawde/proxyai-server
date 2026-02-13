import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Timestamp } from 'typeorm';
import {
  Meeting,
  MeetingProvider,
  MeetingStatus,
  CalendarProvider,
} from 'src/entities/meeting.entity';
import { MeetingPlatformDetector } from './meeting-platform.util';
import { User } from 'src/entities/user.entity';
import { TranscriptEntry } from 'src/entities/transcript-entry.entity';
import { TranscriptSegment } from 'src/entities/transcript-segment.entity';
import { TranscriptsService } from 'src/transcripts/transcripts.service';
import { Summary } from 'src/entities/summary.entity';
import { QAEntry } from 'src/entities/qa-entry.entity';
import { RAGService } from 'src/rag/rag.service';
import axios from 'axios';
import {
  BotWebhookDto,
  ScheduleBotParams,
  ScheduledBot,
} from 'src/entities/bot.entity';
import { Observable } from 'rxjs';
import {
  MeetingStreamService,
  MeetingEvent,
  TranscriptEvent,
  SummaryEvent,
} from './services/meeting-stream.service';
import { PaginatedResponse } from 'src/common';
export type { MeetingEvent, TranscriptEvent, SummaryEvent };
import { MeetingStateMachine } from './states';
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  constructor(
    @InjectRepository(Meeting)
    private meetingsRepository: Repository<Meeting>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(TranscriptSegment)
    private transcriptSegmentRepository: Repository<TranscriptSegment>,
    @InjectRepository(QAEntry)
    private qaRepository: Repository<QAEntry>,
    @InjectRepository(Summary)
    private summariesRepository: Repository<Summary>,

    private transcriptsService: TranscriptsService,
    private ragService: RAGService,
    private meetingStreamService: MeetingStreamService,

    private meetingStateMachine: MeetingStateMachine,
  ) {}

  /**
   * Get SSE stream for user's meeting events
   */
  getUserMeetingStream(userId: string): Observable<any> {
    return this.meetingStreamService.getUserMeetingStream(userId);
  }

  /**
   * Expose event subjects for backward compatibility
   * @deprecated Use MeetingStreamService emit methods instead
   */
  get transcriptEvents$() {
    return this.meetingStreamService.transcriptEventsSubject;
  }

  get summaryEvent$() {
    return this.meetingStreamService.summaryEventsSubject;
  }

  /**
   * Get a meeting by ID with ownership verification
   */
  async getMeetingById(meetingId: number): Promise<Meeting | null> {
    const meeting = await this.meetingsRepository.findOne({
      where: {
        id: meetingId,
        // userId: { firebaseUid: userId },
        isDeleted: false,
      },
    });

    return meeting;
  }

  async getMeetingsByStatus(
    firebaseUid: string,
    query: { status: MeetingStatus; page?: number; limit?: number },
  ) {
    const { status, page = 1, limit = 10 } = query;

    const user = await this.usersRepository.findOne({
      where: { firebaseUid },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const offset = (page - 1) * limit;

    // Build base query for meetings
    const qb = this.meetingsRepository
      .createQueryBuilder('meeting')
      .where('meeting.user_id = :userId', {
        userId: firebaseUid,
      })
      .andWhere('meeting.status = :status', { status })
      .andWhere('meeting.is_deleted = false');

    // Ordering logic
    if (status === MeetingStatus.PAST) {
      qb.orderBy('meeting.start_time', 'DESC');
    } else {
      qb.orderBy('meeting.start_time', 'ASC');
    }

    const meetings = await qb.skip(offset).take(limit).getMany();

    // If no meetings, return early
    if (meetings.length === 0) {
      return [];
    }

    // Get meeting IDs
    const meetingIds = meetings.map((m) => m.id);

    // Fetch latest summary for each meeting using DISTINCT ON
    const latestSummaries = await this.summariesRepository
      .createQueryBuilder('summary')
      .select('DISTINCT ON (summary.meeting_id) summary.*')
      .where('summary.meeting_id IN (:...meetingIds)', { meetingIds })
      .orderBy('summary.meeting_id', 'ASC')
      .addOrderBy('summary.created_at', 'DESC')
      .getRawMany();

    // Create a map of meeting_id -> latest summary
    const summaryMap = new Map();
    latestSummaries.forEach((summary) => {
      summaryMap.set(summary.meeting_id, summary.content);
    });

    // Attach latestSummary to each meeting
    return meetings.map((meeting) => ({
      ...meeting,
      latestSummary: summaryMap.get(meeting.id) || '',
    }));
  }

  async syncMeetings(
    firebaseUid: string,
    tokens: {
      zoomAccessToken?: string;
      googleAccessToken?: string;
      microsoftAccessToken?: string;
    },
  ) {
    const results: Record<string, any> = {};

    if (tokens.googleAccessToken) {
      results.google = await this.syncGoogleCalendar(
        firebaseUid,
        tokens.googleAccessToken,
      );
    }

    if (tokens.zoomAccessToken) {
      results.zoom = {
        synced: 0,
        message:
          'ProxyAI does not support Zoom Calendar yet - use Google Calendar to sync Zoom meetings',
      };
    }

    if (tokens.microsoftAccessToken) {
      results.microsoft = {
        synced: 0,
        message:
          'ProxyAI does not support Microsoft Calendar yet - use Google Calendar to sync Teams meetings',
      };
    }

    return results;
  }

  /*
   * Send a meeting bot state change to the user
   */
  async updateMeetingFromBotState(payload: BotWebhookDto) {
    const { bot_id, data } = payload;

    const botData = data as any;

    const meeting = await this.meetingsRepository.findOne({
      where: { botId: bot_id, isDeleted: false },
      relations: ['user'],
    });

    if (!meeting) return;

    // State Machine for validated transitions
    const result = await this.meetingStateMachine.transitionFromBotState(
      meeting,
      botData.new_state,
    );

    if (!result.success) {
      if (result.error) {
        this.logger.warn(
          `State transition failed for meeting ${meeting.id}: ${result.error}`,
        );
      }
      return;
    }

    // save and emit if status changed
    if (result.previousStatus !== result.newStatus) {
      await this.meetingsRepository.save(meeting);

      // Emit status update via stream service
      this.meetingStreamService.emitMeetingStatusUpdate(
        meeting.userId,
        meeting.id,
        meeting.status,
      );
    }
  }

  async handleTranscriptUpdate(payload: any): Promise<void> {
    const { bot_id, data } = payload;

    const meeting = await this.meetingsRepository.findOne({
      where: { botId: bot_id, isDeleted: false },
      relations: ['user'],
    });

    if (!meeting) return;

    await this.transcriptsService.addTranscript(meeting, data);
  }

  // Private Methods:

  // Sync Google Calendar - detects and syncs all meeting types
  private async syncGoogleCalendar(firebaseUid: string, accessToken: string) {
    let events: any[] = [];
    let synced = 0;

    try {
      const eventsRes = await axios.get(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            maxResults: 100,
            singleEvents: true,
            orderBy: 'startTime',
            timeMin: new Date().toISOString(),
            showDeleted: false,
          },
        },
      );

      events = eventsRes.data.items ?? [];
    } catch (err: any) {
      console.error(
        'Error fetching Google Calendar events:',
        err?.response?.data || err?.message || err,
      );
      return { synced, error: 'Failed to fetch Google Calendar events' };
    }

    for (const event of events) {
      try {
        // Extract meeting URL from various sources
        const meetingUrl = this.extractMeetingUrl(event);

        if (!meetingUrl) continue; // No meeting link found

        // Detect meeting platform from URL
        const meetingProvider =
          MeetingPlatformDetector.detectPlatform(meetingUrl);

        // Currently Supporting only Google Meet.
        // Todo: Exchange below 'if block' with commented out 'if block'
        if (meetingProvider !== 'google_meet') {
          continue;
        }

        // Todo: Exchange with above block
        // if (!meetingProvider) {
        //   this.logger.warn(
        //     `Unsupported meeting platform for URL: ${meetingUrl}`,
        //   );
        //   continue;
        // }

        const startTime = event.start?.dateTime
          ? new Date(event.start.dateTime)
          : null;

        const endTime = event.end?.dateTime
          ? new Date(event.end.dateTime)
          : null;

        if (!startTime) continue;

        const exists = await this.meetingsRepository.findOne({
          where: {
            meetingUrl: meetingUrl,
            userId: firebaseUid,
            isDeleted: false,
          },
        });

        if (exists) continue;

        // Schedule bot for all meeting types
        const meetingBot: ScheduledBot | undefined =
          await this.scheduleMeetingBot({
            meetingUrl: meetingUrl,
            startTime: startTime,
          });

        const createdMeeting = this.meetingsRepository.create({
          title: event.summary ?? 'Untitled Meeting',
          description: event.description ?? null,
          startTime,
          timezone: event.start?.timeZone ?? null,
          duration:
            endTime && startTime
              ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
              : 60,
          status: MeetingStatus.SCHEDULED,
          meetingUrl: meetingUrl,
          calendarProvider: CalendarProvider.GOOGLE,
          meetingProvider: meetingProvider,
          userId: firebaseUid,
          providerMetadata: { event },
          botId: meetingBot?.id ?? '',
        });

        await this.meetingsRepository.save(createdMeeting);
        synced++;
      } catch (err) {
        console.error(`Error processing Google event ${event.id}:`, err);
        continue;
      }
    }

    return { synced };
  }

  /**
   * Extract meeting URL from Google Calendar event
   */
  private extractMeetingUrl(event: any): string | null {
    // Check hangoutLink (Google Meet)
    if (event.hangoutLink) {
      return event.hangoutLink;
    }

    // Check conferenceData (all platforms)
    const conferenceEntry = event.conferenceData?.entryPoints?.find(
      (e: any) => e.entryPointType === 'video',
    );
    if (conferenceEntry?.uri) {
      return conferenceEntry.uri;
    }

    // Check description for meeting links
    if (event.description) {
      // Look for Zoom links
      const zoomMatch = event.description.match(
        /https?:\/\/[^\s]*zoom\.us\/[^\s]*/i,
      );
      if (zoomMatch) return zoomMatch[0];

      // Look for Teams links
      const teamsMatch = event.description.match(
        /https?:\/\/[^\s]*teams\.(microsoft|live)\.com\/[^\s]*/i,
      );
      if (teamsMatch) return teamsMatch[0];

      // Look for Google Meet links
      const meetMatch = event.description.match(
        /https?:\/\/meet\.google\.com\/[^\s]*/i,
      );
      if (meetMatch) return meetMatch[0];
    }

    // Check location field
    if (event.location) {
      const urlMatch = event.location.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) return urlMatch[0];
    }

    return null;
  }

  private async scheduleMeetingBot(params: ScheduleBotParams) {
    const { meetingUrl, startTime, botName = "ProxyAI's Bot" } = params;
    try {
      const response = await axios.post(
        `${process.env.BOT_SERVICE_URL}`,
        {
          meeting_url: meetingUrl,
          bot_name: botName,
          join_at: startTime,
        },
        {
          headers: {
            Authorization: `Token ${process.env.BOT_SERVICE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(
        `Bot scheduled successfully for meeting: ${meetingUrl} | Bot ID: ${response.data?.bot_id || 'N/A'}`,
      );
      return response.data;
    } catch (err: any) {
      this.logger.error(
        `Failed to schedule bot for meeting: ${meetingUrl}`,
        err?.response?.data || err?.message || err,
      );
    }
  }

  async getMeetingSummaries(
    meetingId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<Summary>> {
    const parsedMeetingId = parseInt(meetingId);
    const meeting = await this.getMeetingById(parsedMeetingId);
    if (!meeting) {
      this.logger.warn(`Meeting ${meetingId} not found for summaries`);
    }
    const skip = (page - 1) * limit;
    const result = await this.summariesRepository.findAndCount({
      where: { meetingId: parsedMeetingId },
      order: { createdAt: 'DESC' }, // Newest first
      skip,
      take: limit,
    });

    return PaginatedResponse.fromFindAndCount(result, page, limit);
  }

  async getTranscriptSegments(
    meetingId: number,
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedResponse<TranscriptSegment>> {
    const meeting = await this.meetingsRepository.findOne({
      where: { id: meetingId, userId },
    });

    if (!meeting) {
      throw new Error('Meeting not found or unauthorized');
    }

    const skip = (page - 1) * limit;
    const result = await this.transcriptSegmentRepository.findAndCount({
      where: { meetingId },
      order: { timestampMs: 'DESC' }, // Newest transcript segments first
      skip,
      take: limit,
    });

    return PaginatedResponse.fromFindAndCount(result, page, limit);
  }

  async getQAHistory(
    meetingId: number,
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<QAEntry>> {
    const meeting = await this.meetingsRepository.findOne({
      where: { id: meetingId, userId },
    });

    if (!meeting) {
      throw new Error('Meeting not found or unauthorized');
    }

    const skip = (page - 1) * limit;
    const result = await this.qaRepository.findAndCount({
      where: { meetingId },
      order: { timestamp: 'DESC' }, // Newest first
      skip,
      take: limit,
    });

    return PaginatedResponse.fromFindAndCount(result, page, limit);
  }

  async askQuestion(
    meetingId: number,
    userId: string,
    question: string,
  ): Promise<QAEntry> {
    // Verify user owns the meeting
    const meeting = await this.meetingsRepository.findOne({
      where: { id: meetingId, userId },
    });

    if (!meeting) {
      throw new Error('Meeting not found or unauthorized');
    }

    // Verify meeting has transcripts
    const transcriptCount = await this.transcriptSegmentRepository.count({
      where: { meetingId },
    });

    if (transcriptCount === 0) {
      throw new Error('No transcripts available for this meeting yet');
    }

    // Call RAG service
    return this.ragService.askQuestion(meetingId, userId, question);
  }

  /* ---------------------------------------------------- */
  /* Services yet to implement                            */
  /* ---------------------------------------------------- */

  // Sync Microsoft Calendar - Not implemented (use Google Calendar to sync Teams meetings)
  private async syncMicrosoftCalendar(
    _firebaseUid: string,
    _accessToken: string,
  ) {
    return {
      synced: 0,
      message:
        'ProxyAI does not support Microsoft Calendar yet - use Google Calendar to sync Teams meetings',
    };
  }

  // Sync Zoom Calendar - Not implemented (use Google Calendar to sync Zoom meetings)
  private async syncZoomCalendar(_firebaseUid: string, _accessToken: string) {
    return {
      synced: 0,
      message:
        'ProxyAI does not support Zoom Calendar yet - use Google Calendar to sync Zoom meetings',
    };
  }
}

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

import {
  Provider,
  ProviderOptions,
  WatchStatus,
} from 'src/entities/providers.entity';
import {
  Meeting,
  MeetingStatus,
  CalendarProvider,
  MeetingProvider,
} from 'src/entities/meeting.entity';
import { ProvidersGoogleService } from './providers-google.service';
import {
  GoogleWebhookHeaders,
  GoogleCalendarEvent,
  GoogleCalendarListResponse,
  SyncResult,
  WatchSetupResponse,
} from './dto/calendar-watch.dto';
import { MeetingPlatformDetector } from 'src/meetings/meeting-platform.util';

@Injectable()
export class CalendarWatchService {
  private readonly logger = new Logger(CalendarWatchService.name);

  // Watch channel expiration: 7 days (max allowed by Google)
  // Note: No renewal needed - watch is recreated when user re-authenticates
  private readonly WATCH_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

  // Batch size for parallel event processing
  private readonly EVENT_BATCH_SIZE = 10;

  constructor(
    @InjectRepository(Provider)
    private providersRepository: Repository<Provider>,
    @InjectRepository(Meeting)
    private meetingsRepository: Repository<Meeting>,
    @Inject(forwardRef(() => ProvidersGoogleService))
    private providersGoogleService: ProvidersGoogleService,
  ) {}

  /**
   * Setup a watch channel for a user's Google Calendar.
   * Called after OAuth flow completes.
   */
  async setupWatch(userId: string): Promise<Provider | null> {
    const provider = await this.providersRepository.findOne({
      where: {
        userId,
        providerName: ProviderOptions.google,
        isConnected: true,
      },
    });

    if (!provider) {
      this.logger.warn(
        `No connected Google provider found for userId=${userId}`,
      );
      return null;
    }

    try {
      // Get fresh access token
      const { access_token } =
        await this.providersGoogleService.refreshGoogleToken(
          provider.refreshToken,
        );

      // Generate unique channel ID
      const channelId = uuidv4();
      const expiration = Date.now() + this.WATCH_EXPIRATION_MS;

      // Setup watch channel with Google Calendar API
      const watchResponse = await axios.post<WatchSetupResponse>(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
        {
          id: channelId,
          type: 'web_hook',
          address: process.env.GOOGLE_CALENDAR_WEBHOOK_URL,
          expiration: expiration,
        },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      // Perform initial full sync to get the first syncToken
      const syncToken = await this.performFullSync(userId, access_token);

      // Update provider with watch details
      provider.watchChannelId = channelId;
      provider.watchResourceId = watchResponse.data.resourceId;
      provider.watchExpiresAt = new Date(
        parseInt(watchResponse.data.expiration),
      );
      provider.watchStatus = WatchStatus.ACTIVE;
      provider.syncToken = syncToken;
      provider.lastMessageNumber = 0;

      await this.providersRepository.save(provider);

      this.logger.log(
        `Watch channel setup successful | userId=${userId} | channelId=${channelId}`,
      );

      return provider;
    } catch (err: any) {
      this.logger.error(
        `Failed to setup watch channel | userId=${userId}`,
        err?.response?.data || err?.message || err,
      );

      // Mark watch as failed
      provider.watchStatus = WatchStatus.FAILED;
      await this.providersRepository.save(provider);

      return null;
    }
  }

  /**
   * Stop a watch channel.
   */
  async stopWatch(provider: Provider): Promise<void> {
    if (!provider.watchChannelId || !provider.watchResourceId) {
      return;
    }

    try {
      const { access_token } =
        await this.providersGoogleService.refreshGoogleToken(
          provider.refreshToken,
        );

      await axios.post(
        'https://www.googleapis.com/calendar/v3/channels/stop',
        {
          id: provider.watchChannelId,
          resourceId: provider.watchResourceId,
        },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `Watch channel stopped | channelId=${provider.watchChannelId}`,
      );
    } catch (err: any) {
      // 404 is expected if channel already expired
      if (err?.response?.status !== 404) {
        this.logger.error(
          `Failed to stop watch channel | channelId=${provider.watchChannelId}`,
          err?.response?.data || err?.message || err,
        );
      }
    }

    // Clear watch fields
    provider.watchChannelId = null;
    provider.watchResourceId = null;
    provider.watchExpiresAt = null;
    provider.watchStatus = WatchStatus.STOPPED;
    await this.providersRepository.save(provider);
  }

  /**
   * Handle incoming webhook notification from Google Calendar.
   */
  async handleNotification(headers: GoogleWebhookHeaders): Promise<void> {
    const channelId = headers['x-goog-channel-id'];
    const resourceState = headers['x-goog-resource-state'];
    const messageNumber = parseInt(headers['x-goog-message-number'] || '0', 10);

    // Find provider by channel ID
    const provider = await this.providersRepository.findOne({
      where: { watchChannelId: channelId, watchStatus: WatchStatus.ACTIVE },
    });

    if (!provider) {
      this.logger.warn(`Unknown or inactive channel | channelId=${channelId}`);
      return;
    }

    // Deduplication: skip if we've already processed this message
    if (messageNumber <= provider.lastMessageNumber) {
      this.logger.debug(
        `Skipping duplicate notification | channelId=${channelId} | messageNumber=${messageNumber}`,
      );
      return;
    }

    // Update last message number
    provider.lastMessageNumber = messageNumber;
    await this.providersRepository.save(provider);

    this.logger.log(
      `Webhook received | channelId=${channelId} | state=${resourceState} | messageNumber=${messageNumber}`,
    );

    // Handle different resource states
    if (resourceState === 'sync') {
      // Initial sync notification after watch setup - just acknowledge
      this.logger.log(
        `Sync notification acknowledged | channelId=${channelId}`,
      );
      return;
    }

    if (resourceState === 'exists') {
      // Changes detected - perform incremental sync
      await this.performIncrementalSync(provider);
    }
  }

  /**
   * Sync only today's meetings for a user.
   * Called immediately after calendar connection to give users quick access to their day's meetings.
   */
  async syncTodaysMeetings(
    userId: string,
  ): Promise<{ synced: number; errors: string[] }> {
    const result = { synced: 0, errors: [] as string[] };

    const provider = await this.providersRepository.findOne({
      where: {
        userId,
        providerName: ProviderOptions.google,
        isConnected: true,
      },
    });

    if (!provider) {
      this.logger.warn(
        `No connected Google provider found for userId=${userId}`,
      );
      result.errors.push('No connected Google provider found');
      return result;
    }

    try {
      const { access_token } =
        await this.providersGoogleService.refreshGoogleToken(
          provider.refreshToken,
        );

      // Calculate today's time bounds
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999,
      );

      // Use the current time as timeMin to avoid syncing past meetings
      const timeMin = now > startOfDay ? now : startOfDay;

      let nextPageToken: string | undefined;

      do {
        const response = await axios.get<GoogleCalendarListResponse>(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          {
            headers: { Authorization: `Bearer ${access_token}` },
            params: {
              maxResults: 100,
              singleEvents: true,
              timeMin: timeMin.toISOString(),
              timeMax: endOfDay.toISOString(),
              showDeleted: false,
              pageToken: nextPageToken,
            },
          },
        );

        const { items, nextPageToken: nextPage } = response.data;

        // Process events in parallel batches
        const events = items || [];
        for (let i = 0; i < events.length; i += this.EVENT_BATCH_SIZE) {
          const batch = events.slice(i, i + this.EVENT_BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map((event) => this.processEventChange(userId, event)),
          );

          // Count results and collect errors
          for (let j = 0; j < batchResults.length; j++) {
            const batchResult = batchResults[j];
            if (batchResult.status === 'fulfilled') {
              if (batchResult.value === 'created') {
                result.synced++;
              }
            } else {
              result.errors.push(
                `Event ${batch[j].id}: ${batchResult.reason?.message || 'Unknown error'}`,
              );
            }
          }
        }

        nextPageToken = nextPage;
      } while (nextPageToken);

      this.logger.log(
        `Today's meetings synced | userId=${userId} | synced=${result.synced}`,
      );

      return result;
    } catch (err: any) {
      this.logger.error(
        `Failed to sync today's meetings | userId=${userId}`,
        err?.response?.data || err?.message || err,
      );
      result.errors.push(err?.message || 'Unknown error');
      return result;
    }
  }

  /**
   * Perform a full sync to get the initial syncToken.
   * Returns the syncToken for future incremental syncs.
   */
  private async performFullSync(
    userId: string,
    accessToken: string,
  ): Promise<string | null> {
    let nextPageToken: string | undefined;
    let syncToken: string | null = null;

    try {
      do {
        const response = await axios.get<GoogleCalendarListResponse>(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
              maxResults: 100,
              singleEvents: true,
              timeMin: new Date().toISOString(),
              showDeleted: false,
              pageToken: nextPageToken,
            },
          },
        );

        const { items, nextPageToken: nextPage, nextSyncToken } = response.data;

        // Process events in parallel batches
        const events = items || [];
        for (let i = 0; i < events.length; i += this.EVENT_BATCH_SIZE) {
          const batch = events.slice(i, i + this.EVENT_BATCH_SIZE);
          await Promise.allSettled(
            batch.map((event) => this.processEventChange(userId, event)),
          );
        }

        nextPageToken = nextPage;
        if (nextSyncToken) {
          syncToken = nextSyncToken;
        }
      } while (nextPageToken);

      this.logger.log(`Full sync completed | userId=${userId}`);
      return syncToken;
    } catch (err: any) {
      this.logger.error(
        `Full sync failed | userId=${userId}`,
        err?.response?.data || err?.message || err,
      );
      return null;
    }
  }

  /**
   * Perform incremental sync using the stored syncToken.
   */
  async performIncrementalSync(provider: Provider): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [],
    };

    if (!provider.syncToken) {
      this.logger.warn(`No syncToken available | userId=${provider.userId}`);
      // Fall back to full sync
      try {
        const { access_token } =
          await this.providersGoogleService.refreshGoogleToken(
            provider.refreshToken,
          );
        provider.syncToken = await this.performFullSync(
          provider.userId,
          access_token,
        );
        await this.providersRepository.save(provider);
      } catch (err: any) {
        result.errors.push('Failed to perform full sync fallback');
      }
      return result;
    }

    try {
      const { access_token } =
        await this.providersGoogleService.refreshGoogleToken(
          provider.refreshToken,
        );

      let nextPageToken: string | undefined;
      let newSyncToken: string | null = null;

      do {
        const response = await axios.get<GoogleCalendarListResponse>(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          {
            headers: { Authorization: `Bearer ${access_token}` },
            params: {
              syncToken: provider.syncToken,
              pageToken: nextPageToken,
              showDeleted: true, // Important: include deleted events in incremental sync
            },
          },
        );

        const { items, nextPageToken: nextPage, nextSyncToken } = response.data;

        // Process events in parallel batches
        const events = items || [];
        for (let i = 0; i < events.length; i += this.EVENT_BATCH_SIZE) {
          const batch = events.slice(i, i + this.EVENT_BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map((event) =>
              this.processEventChange(provider.userId, event),
            ),
          );

          // Count results and collect errors
          for (let j = 0; j < batchResults.length; j++) {
            const batchResult = batchResults[j];
            if (batchResult.status === 'fulfilled') {
              if (batchResult.value === 'created') result.created++;
              else if (batchResult.value === 'updated') result.updated++;
              else if (batchResult.value === 'deleted') result.deleted++;
            } else {
              result.errors.push(
                `Event ${batch[j].id}: ${batchResult.reason?.message || 'Unknown error'}`,
              );
            }
          }
        }

        nextPageToken = nextPage;
        if (nextSyncToken) {
          newSyncToken = nextSyncToken;
        }
      } while (nextPageToken);

      // Update syncToken
      if (newSyncToken) {
        provider.syncToken = newSyncToken;
        provider.lastSyncedAt = new Date();
        await this.providersRepository.save(provider);
      }

      this.logger.log(
        `Incremental sync completed | userId=${provider.userId} | created=${result.created} | updated=${result.updated} | deleted=${result.deleted}`,
      );

      return result;
    } catch (err: any) {
      // Handle 410 Gone (sync token expired)
      if (err?.response?.status === 410) {
        this.logger.warn(
          `Sync token expired | userId=${provider.userId} | performing full sync`,
        );

        try {
          const { access_token } =
            await this.providersGoogleService.refreshGoogleToken(
              provider.refreshToken,
            );
          provider.syncToken = await this.performFullSync(
            provider.userId,
            access_token,
          );
          await this.providersRepository.save(provider);
        } catch (fullSyncErr: any) {
          result.errors.push('Failed to recover from expired sync token');
        }
      } else {
        this.logger.error(
          `Incremental sync failed | userId=${provider.userId}`,
          err?.response?.data || err?.message || err,
        );
        result.errors.push(err?.message || 'Unknown error');
      }

      return result;
    }
  }

  /**
   * Process a single event change from Google Calendar.
   * Returns the action taken: 'created', 'updated', 'deleted', or 'skipped'.
   */
  private async processEventChange(
    userId: string,
    event: GoogleCalendarEvent,
  ): Promise<'created' | 'updated' | 'deleted' | 'skipped'> {
    const calendarEventId = event.id;

    // Handle deleted/cancelled events
    if (event.status === 'cancelled') {
      const meeting = await this.meetingsRepository.findOne({
        where: { calendarEventId, userId, isDeleted: false },
      });

      if (meeting) {
        // Cancel the bot if scheduled
        if (meeting.botId) {
          await this.cancelMeetingBot(meeting.botId);
        }

        // Soft delete the meeting
        meeting.isDeleted = true;
        meeting.status = MeetingStatus.CANCELLED;
        await this.meetingsRepository.save(meeting);

        this.logger.log(`Meeting deleted | calendarEventId=${calendarEventId}`);
        return 'deleted';
      }

      return 'skipped';
    }

    // Extract meeting URL
    const meetingUrl = this.extractMeetingUrl(event);

    // Find existing meeting by calendar event ID
    const existingMeeting = await this.meetingsRepository.findOne({
      where: { calendarEventId, userId, isDeleted: false },
    });

    if (existingMeeting) {
      if (!meetingUrl) {
        // Meeting link was removed - soft delete
        if (existingMeeting.botId) {
          await this.cancelMeetingBot(existingMeeting.botId);
        }
        existingMeeting.isDeleted = true;
        existingMeeting.status = MeetingStatus.CANCELLED;
        await this.meetingsRepository.save(existingMeeting);

        this.logger.log(
          `Meeting link removed, deleted | calendarEventId=${calendarEventId}`,
        );
        return 'deleted';
      }

      // Update existing meeting
      return await this.updateMeeting(existingMeeting, event, meetingUrl);
    }

    // No existing meeting - check if we should create one
    if (!meetingUrl) {
      return 'skipped'; // No meeting link, ignore
    }

    // Check if event is in the future
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : null;
    if (!startTime || startTime < new Date()) {
      // Event is in the past or has no start time
      return 'skipped';
    }

    // Detect meeting platform
    const meetingProvider = MeetingPlatformDetector.detectPlatform(meetingUrl);
    if (meetingProvider !== 'google_meet') {
      // Currently only supporting Google Meet
      return 'skipped';
    }

    // Check if meeting with same URL already exists (migration edge case)
    const existingByUrl = await this.meetingsRepository.findOne({
      where: { meetingUrl, userId, isDeleted: false },
    });

    if (existingByUrl) {
      // Update the existing meeting with the calendar event ID
      existingByUrl.calendarEventId = calendarEventId;
      await this.meetingsRepository.save(existingByUrl);
      return 'updated';
    }

    // Create new meeting
    return await this.createMeeting(userId, event, meetingUrl, meetingProvider);
  }

  /**
   * Create a new meeting from a Google Calendar event.
   */
  private async createMeeting(
    userId: string,
    event: GoogleCalendarEvent,
    meetingUrl: string,
    meetingProvider: MeetingProvider,
  ): Promise<'created' | 'skipped'> {
    const startTime = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : null;
    const endTime = event.end?.dateTime ? new Date(event.end.dateTime) : null;

    if (!startTime) {
      return 'skipped';
    }

    try {
      // Schedule bot
      const meetingBot = await this.scheduleMeetingBot(meetingUrl, startTime);

      const meeting = this.meetingsRepository.create({
        title: event.summary ?? 'Untitled Meeting',
        description: event.description ?? '',
        startTime,
        timezone: event.start?.timeZone ?? '',
        duration:
          endTime && startTime
            ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
            : 60,
        status: MeetingStatus.SCHEDULED,
        meetingUrl,
        calendarProvider: CalendarProvider.GOOGLE,
        meetingProvider,
        userId,
        calendarEventId: event.id,
        providerMetadata: { event },
        botId: meetingBot?.id ?? '',
      });

      await this.meetingsRepository.save(meeting);

      this.logger.log(
        `Meeting created | calendarEventId=${event.id} | title=${event.summary}`,
      );

      return 'created';
    } catch (err: any) {
      this.logger.error(
        `Failed to create meeting | calendarEventId=${event.id}`,
        err?.message || err,
      );
      throw err;
    }
  }

  /**
   * Update an existing meeting from a Google Calendar event.
   */
  private async updateMeeting(
    meeting: Meeting,
    event: GoogleCalendarEvent,
    meetingUrl: string,
  ): Promise<'updated' | 'skipped'> {
    const newStartTime = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : null;
    const newEndTime = event.end?.dateTime
      ? new Date(event.end.dateTime)
      : null;

    if (!newStartTime) {
      return 'skipped';
    }

    const oldStartTime = meeting.startTime;
    const oldMeetingUrl = meeting.meetingUrl;

    // Check if time or URL changed (need to reschedule bot)
    const timeChanged = oldStartTime.getTime() !== newStartTime.getTime();
    const urlChanged = oldMeetingUrl !== meetingUrl;

    if (timeChanged || urlChanged) {
      // Cancel old bot
      if (meeting.botId) {
        await this.cancelMeetingBot(meeting.botId);
      }

      // Schedule new bot if event is in the future
      if (newStartTime > new Date()) {
        const meetingBot = await this.scheduleMeetingBot(
          meetingUrl,
          newStartTime,
        );
        meeting.botId = meetingBot?.id ?? '';
      } else {
        meeting.botId = '';
      }
    }

    // Update meeting fields
    meeting.title = event.summary ?? 'Untitled Meeting';
    meeting.description = event.description ?? '';
    meeting.startTime = newStartTime;
    meeting.timezone = event.start?.timeZone ?? '';
    meeting.duration =
      newEndTime && newStartTime
        ? Math.round((newEndTime.getTime() - newStartTime.getTime()) / 60000)
        : 60;
    meeting.meetingUrl = meetingUrl;
    meeting.providerMetadata = { event };

    await this.meetingsRepository.save(meeting);

    this.logger.log(`Meeting updated | calendarEventId=${event.id}`);
    return 'updated';
  }

  /**
   * Extract meeting URL from Google Calendar event.
   */
  private extractMeetingUrl(event: GoogleCalendarEvent): string | null {
    // Check hangoutLink (Google Meet)
    if (event.hangoutLink) {
      return event.hangoutLink;
    }

    // Check conferenceData
    const conferenceEntry = event.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === 'video',
    );
    if (conferenceEntry?.uri) {
      return conferenceEntry.uri;
    }

    // Check description for meeting links
    if (event.description) {
      const zoomMatch = event.description.match(
        /https?:\/\/[^\s]*zoom\.us\/[^\s]*/i,
      );
      if (zoomMatch) return zoomMatch[0];

      const teamsMatch = event.description.match(
        /https?:\/\/[^\s]*teams\.(microsoft|live)\.com\/[^\s]*/i,
      );
      if (teamsMatch) return teamsMatch[0];

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

  /**
   * Schedule a bot for a meeting.
   */
  private async scheduleMeetingBot(
    meetingUrl: string,
    startTime: Date,
    botName = "ProxyAI's Bot",
  ): Promise<{ id: string } | null> {
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
        `Bot scheduled | meetingUrl=${meetingUrl} | botId=${response.data?.id || 'N/A'}`,
      );

      return response.data;
    } catch (err: any) {
      this.logger.error(
        `Failed to schedule bot | meetingUrl=${meetingUrl}`,
        err?.response?.data || err?.message || err,
      );
      return null;
    }
  }

  /**
   * Cancel a scheduled bot.
   */
  private async cancelMeetingBot(botId: string): Promise<void> {
    if (!botId) return;

    try {
      await axios.delete(`${process.env.BOT_SERVICE_URL}/${botId}`, {
        headers: {
          Authorization: `Token ${process.env.BOT_SERVICE_API_KEY}`,
        },
      });

      this.logger.log(`Bot cancelled | botId=${botId}`);
    } catch (err: any) {
      // 404 is expected if bot already ran or was cancelled
      if (err?.response?.status !== 404) {
        this.logger.error(
          `Failed to cancel bot | botId=${botId}`,
          err?.response?.data || err?.message || err,
        );
      }
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Meeting,
  MeetingProvider,
  MeetingStatus,
} from 'src/entities/meeting.entity';
import { User } from 'src/entities/user.entity';
import { TranscriptEntry } from 'src/entities/transcript-entry.entity';
import { TranscriptsService } from 'src/transcripts/transcripts.service';
import { Summary } from 'src/entities/summary.entity';
import { QAEntry } from 'src/entities/qa-entry.entity';
import axios from 'axios';

@Injectable()
export class MeetingsService {
  private gateway: any = null;

  constructor(
    @InjectRepository(Meeting)
    private meetingsRepository: Repository<Meeting>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(TranscriptEntry)
    private transcriptsRepository: Repository<TranscriptEntry>,
    @InjectRepository(Summary)
    private summariesRepository: Repository<Summary>,
    @InjectRepository(QAEntry)
    private qaRepository: Repository<QAEntry>,
    private transcriptsService: TranscriptsService,
  ) {}

  setGateway(gateway: any) {
    this.gateway = gateway;
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

    return meetings;
  }

  async syncMeetings(
    firebaseUid: string,
    tokens: {
      zoomAccessToken?: string;
      googleMeetAccessToken?: string;
      teamsAccessToken?: string;
    },
  ) {
    const results: Record<string, any> = {};

    if (tokens.zoomAccessToken) {
      results.zoom = await this.syncZoomMeetings(
        firebaseUid,
        tokens.zoomAccessToken,
      );
    }

    if (tokens.googleMeetAccessToken) {
      results.googleMeet = await this.syncGoogleMeetMeetings(
        firebaseUid,
        tokens.googleMeetAccessToken,
      );
    }

    if (tokens.teamsAccessToken) {
      results.teams = await this.syncTeamsMeetings(
        firebaseUid,
        tokens.teamsAccessToken,
      );
    }

    return results;
  }

  // Private Methods:

  // Sync Zoom Meetings
  private async syncZoomMeetings(firebaseUid: string, accessToken: string) {
    let meetings: any[] = [];
    let synced = 0;

    try {
      const meetingsRes = await axios.get(
        'https://api.zoom.us/v2/users/me/upcoming_meetings',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { page_size: 100 },
        },
      );

      meetings = meetingsRes.data.meetings ?? [];
    } catch (err) {
      console.error(
        'Error fetching Zoom upcoming meetings:',
        err.response?.data || err.message || err,
      );
      return { synced, error: 'Failed to fetch Zoom upcoming meetings' };
    }

    for (const meeting of meetings) {
      try {
        const startTime = new Date(meeting.start_time);

        const exists = await this.meetingsRepository.findOne({
          where: {
            meetingUrl: meeting.join_url,
            userId: { firebaseUid },
            isDeleted: false,
            status: meeting.status,
          },
        });

        if (exists) continue;

        const createdMeeting = this.meetingsRepository.create({
          title: meeting.topic,
          description: meeting.agenda ?? null,
          startTime,
          endTime: meeting.end_time ?? null,
          timezone: meeting.timezone,
          duration: meeting.duration,
          status: MeetingStatus.SCHEDULED,
          meetingUrl: meeting.join_url,
          provider: MeetingProvider.ZOOM,
          userId: { firebaseUid },
          providerMetadata: { meeting },
        });

        await this.meetingsRepository.save(createdMeeting);
        synced++;
      } catch (err) {
        console.error(`Error processing meeting ${meeting.id}:`, err);
        continue;
      }
    }

    return { synced };
  }

  // Sync Google Meet Meetings
  private async syncGoogleMeetMeetings(
    firebaseUid: string,
    accessToken: string,
  ) {
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
          },
        },
      );

      events = eventsRes.data.items ?? [];
    } catch (err: any) {
      console.error(
        'Error fetching Google Calendar events:',
        err?.response?.data || err?.message || err,
      );
      return { synced, error: 'Failed to fetch Google Meet meetings' };
    }

    for (const event of events) {
      try {
        // Meet link can appear in multiple places
        const meetLink =
          event.hangoutLink ||
          event.conferenceData?.entryPoints?.find(
            (e: any) => e.entryPointType === 'video',
          )?.uri;

        if (!meetLink) continue; // not a Meet meeting

        const startTime = event.start?.dateTime
          ? new Date(event.start.dateTime)
          : null;

        const endTime = event.end?.dateTime
          ? new Date(event.end.dateTime)
          : null;

        if (!startTime) continue;

        const exists = await this.meetingsRepository.findOne({
          where: {
            meetingUrl: meetLink,
            userId: { firebaseUid },
            isDeleted: false,
          },
        });

        if (exists) continue;

        const createdMeeting = this.meetingsRepository.create({
          title: event.summary ?? 'Google Meet',
          description: event.description ?? null,
          startTime,
          timezone: event.start?.timeZone ?? null,
          duration:
            endTime && startTime
              ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
              : 60,
          status: MeetingStatus.SCHEDULED,
          meetingUrl: meetLink,
          provider: MeetingProvider.GOOGLE_MEET,
          userId: { firebaseUid },
          providerMetadata: { event },
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

  // Sync Teams Meetings

  private async syncTeamsMeetings(_firebaseUid: string, _accessToken: string) {
    return { synced: 0 };
  }

  /* ---------------------------------------------------- */
  /* Temporarily Removed Methods Seperated                */
  /* ---------------------------------------------------- */

  // async scheduleMeeting(id: string, createMeetingData: CreateMeetingDto) {
  //   const createdBy = await this.usersRepository.findOne({
  //     where: { firebaseUid: id },
  //   });

  //   if (!createdBy) {
  //     throw new Error('User not found');
  //   }

  //   createMeetingData.participants.push(createdBy.email);

  //   const meeting = this.meetingsRepository.create({
  //     title: createMeetingData.title,
  //     participants: createMeetingData.participants,
  //     createdBy: createdBy.email,
  //     scheduledOn: createMeetingData.scheduledOn,
  //     scheduledStart: new Date(createMeetingData.scheduledStart),
  //     scheduledEnd: new Date(createMeetingData.scheduledEnd),
  //     status: 'scheduled',
  //     meetingRoomName: `meeting-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  //   });

  //   const savedMeeting = await this.meetingsRepository.save(meeting);

  //   return {
  //     ...savedMeeting,
  //   };
  // }

  // async getMeetingById(meetingId: string) {
  //   try {
  //     const meeting = await this.meetingsRepository.findOne({
  //       where: { id: meetingId },
  //     });

  //     if (!meeting) {
  //       throw new NotFoundException('Meeting not found');
  //     }

  //     return meeting;
  //   } catch (error) {
  //     if (error instanceof NotFoundException) {
  //       throw error;
  //     }
  //     throw new InternalServerErrorException(
  //       `Failed to get meeting: ${error.message}`,
  //     );
  //   }
  // }

  // async startMeeting(id: string, firebaseUid: string): Promise<Meeting> {
  //   const user = await this.usersRepository.findOne({
  //     where: { firebaseUid },
  //   });

  //   if (!user) {
  //     throw new NotFoundException('User not found');
  //   }

  //   const meeting = await this.meetingsRepository.findOne({
  //     where: { id },
  //     relations: ['transcript', 'summaries'],
  //   });

  //   if (!meeting) {
  //     throw new NotFoundException('Meeting not found');
  //   }

  //   if (!meeting.participants.includes(user.email)) {
  //     throw new Error('User not authorized for this meeting');
  //   }

  //   meeting.status = 'ongoing';
  //   meeting.startedAt = new Date();

  //   const updatedMeeting = await this.meetingsRepository.save(meeting);

  //   console.log(`Meeting ${id} started. Broadcasting to participants...`);

  //   if (this.gateway) {
  //     this.gateway.broadcastMeetingUpdate(updatedMeeting, 'meeting-started');
  //   }

  //   return updatedMeeting;
  // }

  // async endMeeting(id: string, firebaseUid: string): Promise<Meeting> {
  //   const user = await this.usersRepository.findOne({
  //     where: { firebaseUid },
  //   });

  //   if (!user) {
  //     throw new NotFoundException('User not found');
  //   }

  //   const meeting = await this.meetingsRepository.findOne({
  //     where: { id },
  //     relations: ['transcript', 'summaries'],
  //   });

  //   if (!meeting) {
  //     throw new NotFoundException('Meeting not found');
  //   }

  //   if (!meeting.participants.includes(user.email)) {
  //     throw new Error('User not authorized for this meeting');
  //   }

  //   // Flush remaining transcripts before meeting ends
  //   await this.transcriptsService.flushAndClearMeeting(id);

  //   meeting.status = 'ended';
  //   meeting.endedAt = new Date();

  //   const updatedMeeting = await this.meetingsRepository.save(meeting);

  //   if (this.gateway) {
  //     this.gateway.broadcastMeetingUpdate(updatedMeeting, 'meeting-ended');
  //   }

  //   return updatedMeeting;
  // }

  /**
   * Get paginated transcripts for a meeting
   */
  async getMeetingTranscripts(
    meetingId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    // Validate meeting exists
    // const meeting = await this.meetingsRepository.findOne({
    //   where: { id: meetingId },
    // });
    // if (!meeting) {
    //   throw new NotFoundException('Meeting not found');
    // }
    // // Pagination Calculation
    // const skip = (page - 1) * limit;
    // // Paginated transcript entries
    // const [transcriptEntries, totalEntries] =
    //   await this.transcriptsRepository.findAndCount({
    //     where: { meetingId },
    //     order: { timeStart: 'DESC' },
    //     skip,
    //     take: limit,
    //   });
    // // Flatten transcript segments from entries
    // const allSegments = transcriptEntries.flatMap((entry) =>
    //   entry.transcripts.map((segment) => ({
    //     ...segment,
    //     entryId: entry.id,
    //     batchTimeStart: entry.timeStart,
    //     batchTimeEnd: entry.timeEnd,
    //   })),
    // );
    // // Sorting (Newest First)
    // const transcripts = allSegments.sort((a, b) => {
    //   return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    // });
    // // Todo: Get only count instead of all transcripts
    // // Calculate total segments across all entries
    // const allEntries = await this.transcriptsRepository.find({
    //   where: { meetingId },
    //   select: ['transcripts'],
    // });
    // const totalSegments = allEntries.reduce(
    //   (sum, entry) => sum + entry.transcripts.length,
    //   0,
    // );
    // return {
    //   data: transcripts,
    //   pagination: {
    //     page,
    //     limit,
    //     totalEntries, // Total transcript entries (batches)
    //     totalSegments, // Total individual transcript segments
    //     totalPages: Math.ceil(totalEntries / limit),
    //     hasMore: skip + limit < totalEntries,
    //   },
    // };
  }

  async getMeetingSummaries(
    meetingId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    // const meeting = await this.meetingsRepository.findOne({
    //   where: { id: meetingId },
    // });
    // if (!meeting) {
    //   throw new NotFoundException('Meeting not found');
    // }
    // const skip = (page - 1) * limit;
    // const [summaries, totalSummaries] =
    //   await this.summariesRepository.findAndCount({
    //     where: { meetingId },
    //     order: { createdAt: 'DESC' }, // Newest first
    //     skip,
    //     take: limit,
    //   });
    // return {
    //   data: summaries,
    //   pagination: {
    //     page,
    //     limit,
    //     totalSummaries,
    //     totalPages: Math.ceil(totalSummaries / limit),
    //     hasMore: skip + limit < totalSummaries,
    //   },
    // };
  }

  async getLatestSummary(meetingId: string) {
    // const summary = await this.summariesRepository.findOne({
    //   where: { meetingId },
    //   order: { createdAt: 'DESC' },
    // });
    // return summary;
  }

  async getQAHistory(meetingId: string, page: number = 1, limit: number = 10) {
    // const meeting = await this.meetingsRepository.findOne({
    //   where: { id: meetingId },
    // });
    // if (!meeting) {
    //   throw new NotFoundException('Meeting not found');
    // }
    // const skip = (page - 1) * limit;
    // const [qaEntries, totalQA] = await this.qaRepository.findAndCount({
    //   where: { meetingId },
    //   order: { timestamp: 'ASC' }, // Chronological order (oldest first)
    //   skip,
    //   take: limit,
    // });
    // return {
    //   data: qaEntries,
    //   pagination: {
    //     page,
    //     limit,
    //     totalQA,
    //     totalPages: Math.ceil(totalQA / limit),
    //     hasMore: skip + limit < totalQA,
    //   },
    // };
  }
}

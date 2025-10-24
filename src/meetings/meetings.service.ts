import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Meeting } from 'src/entities/meeting.entity';
import { User } from 'src/entities/user.entity';
import { TranscriptEntry } from 'src/entities/transcript-entry.entity';
import { TranscriptsService } from 'src/transcripts/transcripts.service';
import { Summary } from 'src/entities/summary.entity';

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
    private transcriptsService: TranscriptsService,
  ) {}

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  async getAllMeetings(id: string, queryData: any) {
    const user = await this.usersRepository.findOne({
      where: { firebaseUid: id },
    });
    if (!user) return;

    const meetings = await this.meetingsRepository
      .createQueryBuilder('meeting')
      .where(':email = ANY(meeting.participants)', { email: user.email })
      .orderBy('meeting.scheduledOn', 'DESC')
      .addOrderBy('meeting.scheduledStart', 'DESC')
      .getMany();
    return meetings;
  }

  async scheduleMeeting(id: string, createMeetingData: CreateMeetingDto) {
    const createdBy = await this.usersRepository.findOne({
      where: { firebaseUid: id },
    });

    if (!createdBy) {
      throw new Error('User not found');
    }

    createMeetingData.participants.push(createdBy.email);

    const meeting = this.meetingsRepository.create({
      title: createMeetingData.title,
      participants: createMeetingData.participants,
      createdBy: createdBy.email,
      scheduledOn: createMeetingData.scheduledOn,
      scheduledStart: new Date(createMeetingData.scheduledStart),
      scheduledEnd: new Date(createMeetingData.scheduledEnd),
      status: 'scheduled',
      meetingRoomName: `meeting-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });

    const savedMeeting = await this.meetingsRepository.save(meeting);

    return {
      ...savedMeeting,
    };
  }

  async getMeetingById(meetingId: string) {
    try {
      const meeting = await this.meetingsRepository.findOne({
        where: { id: meetingId },
      });

      if (!meeting) {
        throw new NotFoundException('Meeting not found');
      }

      return meeting;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to get meeting: ${error.message}`,
      );
    }
  }

  async startMeeting(id: string, firebaseUid: string): Promise<Meeting> {
    const user = await this.usersRepository.findOne({
      where: { firebaseUid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const meeting = await this.meetingsRepository.findOne({
      where: { id },
      relations: ['transcript', 'summaries'],
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (!meeting.participants.includes(user.email)) {
      throw new Error('User not authorized for this meeting');
    }

    meeting.status = 'ongoing';
    meeting.startedAt = new Date();

    const updatedMeeting = await this.meetingsRepository.save(meeting);

    console.log(`Meeting ${id} started. Broadcasting to participants...`);

    if (this.gateway) {
      this.gateway.broadcastMeetingUpdate(updatedMeeting, 'meeting-started');
    }

    return updatedMeeting;
  }

  async endMeeting(id: string, firebaseUid: string): Promise<Meeting> {
    const user = await this.usersRepository.findOne({
      where: { firebaseUid },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const meeting = await this.meetingsRepository.findOne({
      where: { id },
      relations: ['transcript', 'summaries'],
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (!meeting.participants.includes(user.email)) {
      throw new Error('User not authorized for this meeting');
    }

    // Flush remaining transcripts before meeting ends
    await this.transcriptsService.flushAndClearMeeting(id);

    meeting.status = 'ended';
    meeting.endedAt = new Date();

    const updatedMeeting = await this.meetingsRepository.save(meeting);

    if (this.gateway) {
      this.gateway.broadcastMeetingUpdate(updatedMeeting, 'meeting-ended');
    }

    return updatedMeeting;
  }

  /**
   * Get paginated transcripts for a meeting
   */
  async getMeetingTranscripts(
    meetingId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    // Validate meeting exists
    const meeting = await this.meetingsRepository.findOne({
      where: { id: meetingId },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // Pagination Calculation
    const skip = (page - 1) * limit;

    // Paginated transcript entries
    const [transcriptEntries, totalEntries] =
      await this.transcriptsRepository.findAndCount({
        where: { meetingId },
        order: { timeStart: 'DESC' },
        skip,
        take: limit,
      });

    // Flatten transcript segments from entries
    const allSegments = transcriptEntries.flatMap((entry) =>
      entry.transcripts.map((segment) => ({
        ...segment,
        entryId: entry.id,
        batchTimeStart: entry.timeStart,
        batchTimeEnd: entry.timeEnd,
      })),
    );

    // Sorting (Newest First)
    const transcripts = allSegments.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Todo: Get only count instead of all transcripts
    // Calculate total segments across all entries
    const allEntries = await this.transcriptsRepository.find({
      where: { meetingId },
      select: ['transcripts'],
    });

    const totalSegments = allEntries.reduce(
      (sum, entry) => sum + entry.transcripts.length,
      0,
    );

    return {
      data: transcripts,
      pagination: {
        page,
        limit,
        totalEntries, // Total transcript entries (batches)
        totalSegments, // Total individual transcript segments
        totalPages: Math.ceil(totalEntries / limit),
        hasMore: skip + limit < totalEntries,
      },
    };
  }

  async getMeetingSummaries(
    meetingId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const meeting = await this.meetingsRepository.findOne({
      where: { id: meetingId },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    const skip = (page - 1) * limit;

    const [summaries, totalSummaries] =
      await this.summariesRepository.findAndCount({
        where: { meetingId },
        order: { createdAt: 'DESC' }, // Newest first
        skip,
        take: limit,
      });

    return {
      data: summaries,
      pagination: {
        page,
        limit,
        totalSummaries,
        totalPages: Math.ceil(totalSummaries / limit),
        hasMore: skip + limit < totalSummaries,
      },
    };
  }

  async getLatestSummary(meetingId: string) {
    const summary = await this.summariesRepository.findOne({
      where: { meetingId },
      order: { createdAt: 'DESC' },
    });

    return summary;
  }
}

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

@Injectable()
export class MeetingsService {
  private gateway: any = null;

  constructor(
    @InjectRepository(Meeting)
    private meetingsRepository: Repository<Meeting>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(TranscriptEntry)
    private transcriptRepository: Repository<TranscriptEntry>,
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
      // transcript: [],
      // summaries: [],
    };
  }

  async getMeetingById(meetingId: string) {
    try {
      const meeting = await this.meetingsRepository.findOne({
        where: { id: meetingId },
        relations: ['transcript', 'summaries'],
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

    meeting.status = 'ended';
    meeting.endedAt = new Date();

    const updatedMeeting = await this.meetingsRepository.save(meeting);

    if (this.gateway) {
      this.gateway.broadcastMeetingUpdate(updatedMeeting, 'meeting-ended');
    }

    return updatedMeeting;
  }

  async addTranscriptEntry(
    id: string,
    entry: {
      speaker: string;
      text: string;
      timestamp: string;
    },
  ): Promise<TranscriptEntry> {
    const meeting = await this.meetingsRepository.findOne({
      where: { id },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // Create transcript with proper meeting relation
    const transcriptEntity = this.transcriptRepository.create({
      speaker: entry.speaker,
      text: entry.text,
      timestamp: new Date(entry.timestamp),
      meeting: meeting,
    });

    return await this.transcriptRepository.save(transcriptEntity);
  }

  async getMeetingTranscripts(id: string) {}
}

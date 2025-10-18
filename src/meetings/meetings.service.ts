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

@Injectable()
export class MeetingsService {
  constructor(
    @InjectRepository(Meeting)
    private meetingsRepository: Repository<Meeting>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async getAllMeetings(id: string, queryData: any) {
    const user = await this.usersRepository.findOne({
      where: { firebaseUid: id },
    });
    if (!user) return;
    const meetings = await this.meetingsRepository
      .createQueryBuilder('meeting')
      .leftJoinAndSelect('meeting.transcript', 'transcript')
      .leftJoinAndSelect('meeting.summaries', 'summaries')
      .where(':email = ANY(meeting.participants)', { email: user.email })
      .orderBy('meeting.scheduledOn', 'ASC')
      .orderBy('meeting.scheduledStart', 'ASC')
      .addOrderBy('transcript.timestamp', 'ASC')
      .addOrderBy('summaries.timestamp', 'ASC')
      .getMany();
    return meetings;
  }
  async findByFirebaseUid(id: string) {}

  async scheduleMeeting(id: string, createMeetingData: CreateMeetingDto) {
    const createdBy = await this.usersRepository.findOne({
      where: { firebaseUid: id },
    });

    if (!createdBy) {
      throw new Error('User not found');
    }

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
      transcript: [],
      summaries: [],
    };
  }

  async getMeetingById(meetingId: string) {
    try {
      const meeting = await this.meetingsRepository.findOne({
        where: { id: meetingId },
      });

      return meeting;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to get user: ${error.message}`,
      );
    }
  }
}

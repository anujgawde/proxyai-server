import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TranscriptEntry } from './transcript-entry.entity';
import { TranscriptSegment } from './transcript-segment.entity';
import { Summary } from './summary.entity';
import { QAEntry } from './qa-entry.entity';
import { User } from './user.entity';

export enum MeetingProvider {
  ZOOM = 'zoom',
  GOOGLE_MEET = 'google_meet',
  TEAMS = 'teams',
}

export enum MeetingStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  PAST = 'past',
  NO_SHOW = 'no_show',
  CANCELLED = 'cancelled',
}

@Entity('meetings')
export class Meeting {
  @PrimaryGeneratedColumn('increment', { name: 'id' })
  id: number;

  @Column('varchar', { length: 512, name: 'title' })
  title: string;

  @Column('text', { nullable: true, name: 'description' })
  description: string;

  @Column('timestamp', { name: 'start_time' })
  startTime: Date;

  @Column('timestamp', { nullable: true, name: 'end_time' })
  endTime: Date;

  @Column('varchar', { length: 100, nullable: true, name: 'timezone' })
  timezone: string;

  @Column('int', { nullable: true, name: 'duration' })
  duration: number;

  @Column({
    type: 'enum',
    enum: MeetingStatus,
    name: 'status',
  })
  status: MeetingStatus;

  @Column('varchar', { length: 255, name: 'meeting_url' })
  meetingUrl: string;

  @Column({
    type: 'enum',
    enum: MeetingProvider,
    name: 'provider',
  })
  provider: MeetingProvider;

  @Column('varchar', { length: 255, nullable: true, name: 'organizer_id' })
  organizerId: string;

  @Column('int', { default: 0, nullable: true, name: 'expected_participants' })
  expectedParticipants: number;

  @Column('int', { default: 0, nullable: true, name: 'present_participants' })
  presentParticipants: number;

  @Column('jsonb', { name: 'provider_metadata' })
  providerMetadata: Record<string, any>;

  @Column('boolean', { default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @Column('varchar', { nullable: true, name: 'bot_id' })
  botId: string;

  @Column('varchar', { name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @OneToMany(() => TranscriptEntry, (transcript) => transcript.meeting, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  transcripts: TranscriptEntry[];

  @OneToMany(() => TranscriptSegment, (segment) => segment.meeting, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  transcriptSegments: TranscriptSegment[];

  @OneToMany(() => Summary, (summary) => summary.meeting, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  summaries: Summary[];

  @OneToMany(() => QAEntry, (qa) => qa.meeting, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  qaEntries: QAEntry[];

  @ManyToOne(() => User, (user) => user.firebaseUid, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'firebaseUid' })
  user: User;
}

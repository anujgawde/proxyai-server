import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Meeting } from './meeting.entity';

export interface TranscriptData {
  speaker_name: string;
  speaker_uuid: string;
  speaker_user_uuid: string;
  speaker_is_host: boolean;
  timestamp_ms: number;
  duration_ms: string;
  transcription: { transcript: string; words: number };
}

@Entity('transcript_entries')
// @Index(['meetingId'])
// @Index(['createdAt'])
export class TranscriptEntry {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column('jsonb')
  transcripts: TranscriptData[];

  @Column({ type: 'int', name: 'meeting_id' })
  meetingId: number;

  @Column({ type: 'timestamp', name: 'time_start' })
  timeStart: Date;

  @Column('timestamp', { nullable: true, name: 'time_end' })
  timeEnd: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Meeting, (meeting) => meeting.transcripts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;
}

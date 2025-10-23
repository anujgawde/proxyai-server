import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Meeting } from './meeting.entity';

export interface TranscriptData {
  speakerEmail: string;
  speakerName: string;
  text: string;
  timestamp: string;
}

@Entity('transcript_entries')
export class TranscriptEntry {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'jsonb' })
  transcripts: TranscriptData[];

  @ManyToOne(() => Meeting, (meeting) => meeting.transcript, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;

  @Column({ type: 'uuid', name: 'meeting_id' })
  meetingId: string;

  @CreateDateColumn({ name: 'time_start' })
  timeStart: string;

  @CreateDateColumn({ name: 'time_end' })
  timeEnd: string;
}

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
  speakerEmail: string;
  speakerName: string;
  text: string;
  timestamp: string;
}

@Entity('transcript_entries')
// @Index(['meetingId'])
// @Index(['createdAt'])
export class TranscriptEntry {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column('jsonb')
  transcripts: TranscriptData[];

  @Column('int')
  meetingId: number;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  timeStart: Date;

  @Column('timestamp', { nullable: true })
  timeEnd: Date;

  @CreateDateColumn()
  createdAt: Date;

  // Relations
  @ManyToOne(() => Meeting, (meeting) => meeting.transcripts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;
}

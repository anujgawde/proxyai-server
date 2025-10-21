import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Meeting } from './meeting.entity';

@Entity('transcript_entries')
export class TranscriptEntry {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar', length: 255 })
  speaker: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'timestamp' })
  timestamp: Date;

  @ManyToOne(() => Meeting, (meeting) => meeting.transcript, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;

  @Column({ type: 'uuid', name: 'meeting_id' })
  meetingId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

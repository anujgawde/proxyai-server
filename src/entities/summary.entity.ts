import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Meeting } from './meeting.entity';

@Entity('summaries')
export class Summary {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'text' })
  content: string;

  @ManyToOne(() => Meeting, (meeting) => meeting.summaries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;

  @Column({ type: 'uuid', name: 'meeting_id' })
  meetingId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: string;
}

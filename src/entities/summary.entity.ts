import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Meeting } from './meeting.entity';

@Entity('summaries')
export class Summary {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column('text')
  content: string;

  @Column({ type: 'int', name: 'meeting_id' })
  meetingId: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Meeting, (meeting) => meeting.summaries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Meeting } from './meeting.entity';

export enum QAStatus {
  ASKING = 'asking',
  ANSWERED = 'answered',
  ERROR = 'error',
}

@Entity('qa_entries')
export class QAEntry {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column('varchar', { length: 255, name: 'user_id' })
  userId: string;

  @Column('int', { name: 'meeting_id' })
  meetingId: number;

  @Column('text')
  question: string;

  @Column('text')
  answer: string;

  @CreateDateColumn()
  timestamp: Date;

  @Column({
    type: 'enum',
    enum: QAStatus,
    nullable: true,
  })
  status?: QAStatus;

  @Column('text', { array: true, nullable: true })
  sources?: string[];

  // Relations
  @ManyToOne(() => User, (user) => user.qaEntries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'firebaseUid' })
  user: User;

  @ManyToOne(() => Meeting, (meeting) => meeting.qaEntries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;
}

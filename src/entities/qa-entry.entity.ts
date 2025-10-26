import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from 'src/entities/user.entity';
import { Meeting } from 'src/entities/meeting.entity';

@Entity('qa_entries')
export class QAEntry {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'speaker_name' })
  speakerName: string;

  @Column({ name: 'speaker_email' })
  speakerEmail: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  @CreateDateColumn()
  timestamp: string;

  @Column({
    type: 'enum',
    enum: ['asking', 'answered', 'error'],
    nullable: true,
  })
  status?: 'asking' | 'answered' | 'error';

  @Column({ type: 'text', array: true, nullable: true })
  sources?: string[];

  // ---- RELATIONS ----
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

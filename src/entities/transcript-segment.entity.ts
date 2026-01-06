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

@Entity('transcript_segments')
@Index(['meetingId'])
@Index(['timestampMs'])
@Index(['meetingId', 'timestampMs'])
export class TranscriptSegment {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'int', name: 'meeting_id' })
  meetingId: number;

  @Column({ type: 'varchar', length: 255, name: 'speaker_name' })
  speakerName: string;

  @Column({ type: 'varchar', length: 255, name: 'speaker_uuid' })
  speakerUuid: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'speaker_user_uuid',
    nullable: true,
  })
  speakerUserUuid: string;

  @Column({ type: 'boolean', name: 'speaker_is_host', default: false })
  speakerIsHost: boolean;

  @Column({ type: 'text', nullable: true })
  transcript: string;

  @Column({ type: 'jsonb', name: 'words', nullable: true })
  words: any;

  @Column({ type: 'bigint', name: 'timestamp_ms' })
  timestampMs: string; // Use string for bigint to avoid precision loss

  @Column({ type: 'bigint', name: 'duration_ms' })
  durationMs: string; // Use string for bigint to avoid precision loss

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Meeting, (meeting) => meeting.transcriptSegments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting: Meeting;
}

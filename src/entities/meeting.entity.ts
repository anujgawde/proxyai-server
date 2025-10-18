import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { TranscriptEntry } from './transcript-entry.entity';
import { Summary } from './summary.entity';

@Entity('meetings')
export class Meeting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false, name: 'title' })
  title: string;

  @Column({ type: 'text', array: true, nullable: false, name: 'participants' })
  participants: string[];

  @Column({ type: 'varchar', length: 255, nullable: false, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'date', nullable: false, name: 'scheduled_on' })
  scheduledOn: Date;

  @Column({ type: 'timestamptz', nullable: false, name: 'scheduled_start' })
  scheduledStart: Date;

  @Column({ type: 'timestamptz', nullable: false, name: 'scheduled_end' })
  scheduledEnd: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'started_at' })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'ended_at' })
  endedAt: Date | null;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: false,
    name: 'status',
    default: 'scheduled',
  })
  status: 'scheduled' | 'ongoing' | 'ended';

  @Column({
    type: 'varchar',
    length: 255,
    nullable: false,
    name: 'meeting_room_name',
  })
  meetingRoomName: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Column({
    type: 'timestamptz',
    nullable: false,
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => TranscriptEntry, (transcript) => transcript.meeting, {
    cascade: true,
    eager: false,
  })
  transcript: TranscriptEntry[];

  @OneToMany(() => Summary, (summary) => summary.meeting, {
    cascade: true,
    eager: false,
  })
  summaries: Summary[];
}

import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('meetings')
export class Meeting {
  @PrimaryColumn('int', { name: 'id', nullable: false })
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: false, name: 'title' })
  title: string;

  @Column({ type: 'text', array: true, nullable: false, name: 'participants' })
  participants: string[];

  @Column({ type: 'varchar', length: 255, nullable: false, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'timestamptz', nullable: false, name: 'scheduled_for' })
  scheduledFor: Date;

  @Column({ type: 'timestamptz', nullable: false, name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: false, name: 'ended_at' })
  endedAt: Date;

  //   Todo: Set up column with enum data type.
  //   @Column({ type: 'enum', length: 255, nullable: false, name: 'status' })
  //   status: string;

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
}

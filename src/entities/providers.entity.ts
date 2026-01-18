import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';

export enum ProviderOptions {
  'zoom' = 'zoom',
  'google' = 'google',
  'microsoft' = 'microsoft',
}

export enum WatchStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  STOPPED = 'stopped',
  FAILED = 'failed',
}
@Entity('providers')
@Unique(['userId', 'providerName'])
export class Provider {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'provider_name' })
  providerName: ProviderOptions;

  @Column({ type: 'text', name: 'refresh_token' })
  refreshToken: string;

  @Column({ type: 'boolean', name: 'is_connected' })
  isConnected: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'last_synced_at' })
  lastSyncedAt: Date | null;

  // Calendar Watch Fields (for real-time sync via push notifications)
  @Column({ type: 'varchar', nullable: true, name: 'watch_channel_id' })
  @Index()
  watchChannelId: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'watch_resource_id' })
  watchResourceId: string | null;

  @Column({ type: 'text', nullable: true, name: 'sync_token' })
  syncToken: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'watch_expires_at' })
  @Index()
  watchExpiresAt: Date | null;

  @Column({
    type: 'enum',
    enum: WatchStatus,
    nullable: true,
    name: 'watch_status',
  })
  watchStatus: WatchStatus | null;

  @Column({ type: 'int', default: 0, name: 'last_message_number' })
  lastMessageNumber: number;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

export enum ProviderOptions {
  'zoom' = 'zoom',
  'google' = 'google',
  'microsoft' = 'microsoft',
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
}

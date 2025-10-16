import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AuthProviderEnum {
  EMAIL = 'email',
  GOOGLE = 'google',
}

@Entity('users')
export class User {
  @PrimaryColumn('varchar', { name: 'firebase_uid', nullable: false })
  firebaseUid: string;

  @Column({ type: 'varchar', length: 255, name: 'email' })
  @Index({ unique: true })
  email: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'photo_url' })
  photoURL: string | null;

  @Column({
    type: 'enum',
    enum: AuthProviderEnum,
    default: AuthProviderEnum.EMAIL,
    name: 'auth_provider',
  })
  authProvider: AuthProviderEnum;

  @Column({ type: 'boolean', default: false, name: 'email_verified' })
  emailVerified: boolean;

  @Column({ type: 'json', nullable: true, name: 'metadata' })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', default: Date.now() })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', default: Date.now() })
  updatedAt: Date;
}

import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { AuthProviderEnum } from '../../entities/user.entity';

export class CreateUserDto {
  @IsString()
  firebaseUid: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  photoURL?: string;

  @IsEnum(AuthProviderEnum)
  authProvider: AuthProviderEnum;

  @IsBoolean()
  @IsOptional()
  emailVerified?: boolean;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  // Todo: Allow user to edit these too
  // @IsString()
  // @IsOptional()
  // photoURL?: string;
}

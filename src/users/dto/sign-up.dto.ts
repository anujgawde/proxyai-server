import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class SignUpDto {
  @IsString()
  firebaseUid: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  photoURL: string | null;

  @IsObject()
  metadata: Record<string, any>;

  @IsBoolean()
  emailVerified: boolean;

  @IsString()
  authProvider: string;
}

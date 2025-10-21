import { IsString, IsOptional } from 'class-validator';

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

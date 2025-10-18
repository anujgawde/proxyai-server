import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  IsDateString,
} from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  participants: string[];

  @IsDateString()
  scheduledOn: string; // Date only: YYYY-MM-DD

  @IsDateString()
  scheduledStart: string; // Full datetime with timezone

  @IsDateString()
  scheduledEnd: string; // Full datetime with timezone
}

import {
  Controller,
  Get,
  Post,
  Headers,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebae-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { MeetingsService } from './meetings.service';
import { MeetingStatus } from 'src/entities/meeting.entity';

@Controller('meetings')
@UseGuards(FirebaseAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  async getMeetings(
    @CurrentUser() user: DecodedIdToken,
    @Query('status') status: MeetingStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.meetingsService.getMeetingsByStatus(user.uid, {
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
    });
  }

  @Post('sync')
  async syncMeetings(
    @CurrentUser() user: DecodedIdToken,
    @Headers() headers: Record<string, string>,
  ) {
    return this.meetingsService.syncMeetings(user.uid, {
      zoomAccessToken: headers['x-zoom-access-token'],
      googleMeetAccessToken: headers['x-google_meet-access-token'],
      teamsAccessToken: headers['x-teams-access-token'],
    });
  }

  // API Routes to get history of transcripts, summaries and QnA
  @Get(':id/transcripts')
  async getMeetingTranscripts(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 1,
  ) {
    return this.meetingsService.getMeetingTranscripts(id, page, limit);
  }

  @Get(':id/summaries')
  async getMeetingSummaries(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.meetingsService.getMeetingSummaries(id, page, limit);
  }

  @Get(':id/qa-history')
  async getQAHistory(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.meetingsService.getQAHistory(id, page, limit);
  }

  // @Get(':id')
  // async getMeetingById(@Param('id') id: string) {
  //   return this.meetingsService.getMeetingById(id);
  // }
}

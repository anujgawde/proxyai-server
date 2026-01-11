import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Param,
  Query,
  UseGuards,
  Sse,
  BadRequestException,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebae-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { MeetingsService } from './meetings.service';
import { MeetingStatus } from 'src/entities/meeting.entity';
import { Observable } from 'rxjs';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  @UseGuards(FirebaseAuthGuard)
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
  @UseGuards(FirebaseAuthGuard)
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
  @Get(':id/summaries')
  @UseGuards(FirebaseAuthGuard)
  async getMeetingSummaries(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.meetingsService.getMeetingSummaries(id, page, limit);
  }

  @Get(':id/transcript-segments')
  @UseGuards(FirebaseAuthGuard)
  async getMeetingTranscriptSegments(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @CurrentUser() user: DecodedIdToken,
  ) {
    return this.meetingsService.getTranscriptSegments(
      parseInt(id),
      user.uid,
      page,
      limit,
    );
  }

  @Get(':id/qa-history')
  @UseGuards(FirebaseAuthGuard)
  async getQAHistory(
    @Param('id') id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @CurrentUser() user: DecodedIdToken,
  ) {
    return this.meetingsService.getQAHistory(
      parseInt(id),
      user.uid,
      page,
      limit,
    );
  }

  @Post(':id/ask-question')
  @UseGuards(FirebaseAuthGuard)
  async askQuestion(
    @Param('id') id: string,
    @Body() body: { question: string },
    @CurrentUser() user: DecodedIdToken,
  ) {
    if (!body.question || body.question.trim().length === 0) {
      throw new BadRequestException('Question cannot be empty');
    }

    if (body.question.length > 500) {
      throw new BadRequestException('Question too long (max 500 characters)');
    }

    return this.meetingsService.askQuestion(
      parseInt(id),
      user.uid,
      body.question.trim(),
    );
  }

  @Sse('sse')
  streamMeetings(@Query('userId') userId: string): Observable<MessageEvent> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    // Subscribe this specific user to their meeting updates
    return this.meetingsService.getUserMeetingStream(userId);
  }

  // @Get(':id')
  // async getMeetingById(@Param('id') id: string) {
  //   return this.meetingsService.getMeetingById(id);
  // }
}

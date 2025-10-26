import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebae-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
@UseGuards(FirebaseAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  async getAllMeetings(
    @CurrentUser() user: DecodedIdToken,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.meetingsService.getAllMeetings(user.uid, {
      status,
      startDate,
      endDate,
      page,
      limit,
    });
  }

  @Get(':id')
  async getMeetingById(@Param('id') id: string) {
    return this.meetingsService.getMeetingById(id);
  }

  @Post()
  async scheduleMeeting(
    @CurrentUser() user: DecodedIdToken,
    @Body() createMeetingDto: any,
  ) {
    return this.meetingsService.scheduleMeeting(user.uid, createMeetingDto);
  }

  @Post(':id/start')
  async startMeeting(
    @CurrentUser() user: DecodedIdToken,
    @Param('id') id: string,
  ) {
    return this.meetingsService.startMeeting(id, user.uid);
  }

  @Post(':id/end')
  async endMeeting(
    @CurrentUser() user: DecodedIdToken,
    @Param('id') id: string,
  ) {
    return this.meetingsService.endMeeting(id, user.uid);
  }

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

  // @Post(':id/transcript')
  // async addTranscriptEntry(
  //   @Param('id') id: string,
  //   @Body()
  //   entry: {
  //     speaker: string;
  //     text: string;
  //     timestamp: string;
  //   },
  // ) {
  //   return this.meetingsService.addTranscriptEntry(id, entry);
  // }

  // @Patch(':id')
  // async updateMeeting(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  //   @Body() updateMeetingDto: any,
  // ) {
  //   return this.meetingsService.update(id, user.uid, updateMeetingDto);
  // }

  // @Delete(':id')
  // async deleteMeeting(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  // ) {
  //   return this.meetingsService.delete(id, user.uid);
  // }

  // @Post(':id/cancel')
  // async cancelMeeting(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  // ) {
  //   return this.meetingsService.cancel(id, user.uid);
  // }

  // @Post(':id/join')
  // async joinMeeting(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  // ) {
  //   return this.meetingsService.join(id, user.uid);
  // }

  // @Post(':id/leave')
  // async leaveMeeting(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  // ) {
  //   return this.meetingsService.leave(id, user.uid);
  // }

  // @Get(':id/participants')
  // async getParticipants(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  // ) {
  //   return this.meetingsService.getParticipants(id, user.uid);
  // }

  // @Post(':id/participants')
  // async addParticipant(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  //   @Body('userId') userId: string,
  // ) {
  //   return this.meetingsService.addParticipant(id, user.uid, userId);
  // }

  // @Delete(':id/participants/:userId')
  // async removeParticipant(
  //   @CurrentUser() user: DecodedIdToken,
  //   @Param('id') id: string,
  //   @Param('userId') userId: string,
  // ) {
  //   return this.meetingsService.removeParticipant(id, user.uid, userId);
  // }
}

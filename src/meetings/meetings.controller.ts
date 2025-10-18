import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
    console.log('get by id');
    return this.meetingsService.getMeetingById(id);
  }

  @Post()
  async scheduleMeeting(
    @CurrentUser() user: DecodedIdToken,
    @Body() createMeetingDto: any,
  ) {
    return this.meetingsService.scheduleMeeting(user.uid, createMeetingDto);
  }

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

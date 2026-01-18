import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  UseGuards,
  Get,
  ValidationPipe,
  UsePipes,
  Headers,
} from '@nestjs/common';
import { MeetingsService } from 'src/meetings/meetings.service';
import { CalendarWatchService } from 'src/providers/calendar-watch.service';
import { GoogleWebhookHeaders } from 'src/providers/dto/calendar-watch.dto';

// Todo: Temp removed, webhook auth not working
import { BotWebhookDto } from 'src/entities/bot.entity';
import { AttendeeWebhookGuard } from './attendee-webhook.guard';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly calendarWatchService: CalendarWatchService,
  ) {}

  @Post('/bots')
  @HttpCode(200)
  // @UseGuards(AttendeeWebhookGuard)
  // @UsePipes(
  //   new ValidationPipe({
  //     transform: false,
  //     whitelist: false,
  //     forbidNonWhitelisted: false,
  //   }),
  // )
  async handleBotWebhook(@Body() payload: any) {
    this.logger.log(
      `Received Webhook trigger ${payload.trigger} for bot ${payload.bot_id}`,
    );

    try {
      if (payload.trigger === 'bot.state_change') {
        await this.meetingsService.updateMeetingFromBotState(payload);
      } else if (payload.trigger === 'transcript.update') {
        await this.meetingsService.handleTranscriptUpdate(payload);
      }
      return { success: true };
    } catch (error) {
      this.logger.error('Error handling bot state webhook:', error);
      // Return 200 anyway to avoid Attendee retrying
      return { success: false, error: error.message };
    }
  }

  @Get('/bot-test')
  @HttpCode(200)
  // @UseGuards(AttendeeWebhookGuard)
  async testRoute() {
    return 'Controller is working';
  }

  /**
   * Google Calendar webhook endpoint.
   * Receives push notifications when calendar events change.
   * Must respond with 200 quickly - Google expects fast acknowledgment.
   */
  @Post('/calendar')
  @HttpCode(200)
  async handleCalendarWebhook(
    @Headers() headers: Record<string, string>,
  ): Promise<void> {
    const googleHeaders: GoogleWebhookHeaders = {
      'x-goog-channel-id': headers['x-goog-channel-id'],
      'x-goog-resource-id': headers['x-goog-resource-id'],
      'x-goog-resource-state': headers['x-goog-resource-state'] as
        | 'sync'
        | 'exists'
        | 'not_exists',
      'x-goog-message-number': headers['x-goog-message-number'],
      'x-goog-channel-token': headers['x-goog-channel-token'],
      'x-goog-channel-expiration': headers['x-goog-channel-expiration'],
    };

    this.logger.log(
      `Calendar webhook received | channelId=${googleHeaders['x-goog-channel-id']} | state=${googleHeaders['x-goog-resource-state']}`,
    );

    // Process asynchronously to respond quickly
    // Google expects a response within seconds
    this.calendarWatchService
      .handleNotification(googleHeaders)
      .catch((err) => {
        this.logger.error('Error handling calendar webhook:', err);
      });
  }
}

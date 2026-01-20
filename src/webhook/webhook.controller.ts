import {
  Controller,
  Post,
  Body,
  Logger,
  HttpCode,
  Get,
  Headers,
} from '@nestjs/common';
import { MeetingsService } from 'src/meetings/meetings.service';
import { CalendarWatchService } from 'src/providers/calendar-watch.service';
import { GoogleWebhookHeaders } from 'src/providers/dto/calendar-watch.dto';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly calendarWatchService: CalendarWatchService,
  ) {}

  /**
   * Bot webhook endpoint - handles transcript updates and bot state changes.
   */
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
        // Bot State updates are less frequent:
        await this.meetingsService.updateMeetingFromBotState(payload);
      } else if (payload.trigger === 'transcript.update') {
        this.meetingsService.handleTranscriptUpdate(payload).catch((err) => {
          this.logger.error(`Transcript update error: ${err.message}`);
        });
      }
      return { success: true };
    } catch (error: any) {
      this.logger.error('Error handling bot webhook:', error);
      return { success: false, error: error.message };
    }
  }

  @Get('/bot-test')
  @HttpCode(200)
  async testRoute() {
    return 'Controller is working';
  }

  /**
   * Google Calendar webhook endpoint.
   * Receives push notifications when calendar events change.
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

    // processing asynchronously
    // Google expects a response within seconds
    this.calendarWatchService.handleNotification(googleHeaders).catch((err) => {
      this.logger.error('Error handling calendar webhook:', err);
    });
  }
}

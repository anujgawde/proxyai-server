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
} from '@nestjs/common';
import { MeetingsService } from 'src/meetings/meetings.service';

// Todo: Temp removed, webhook auth not working
import { BotWebhookDto } from 'src/entities/bot.entity';
import { AttendeeWebhookGuard } from './attendee-webhook.guard';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly meetingsService: MeetingsService) {}

  @Post('/bots')
  @HttpCode(200)
  @UseGuards(AttendeeWebhookGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  async handleBotWebhook(@Body() payload: BotWebhookDto) {
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
}

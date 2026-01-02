import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface ScheduleBotParams {
  meetingUrl: string;
  startTime: Date;
  botName?: string;
}

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  /**
   * Schedule a bot for a meeting
   * This is fire-and-forget - errors are logged but don't throw
   */
  async scheduleBotForMeeting(params: ScheduleBotParams): Promise<void> {
    const { meetingUrl, startTime, botName = "ProxyAI's Bot" } = params;
    try {
      const response = await axios.post(
        `${process.env.BOT_SERVICE_URL}`,
        {
          meeting_url: meetingUrl,
          bot_name: botName,
          join_at: startTime,
        },
        {
          headers: {
            Authorization: `Token ${process.env.BOT_SERVICE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `Bot scheduled successfully for meeting: ${meetingUrl} | Bot ID: ${response.data?.bot_id || 'N/A'}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to schedule bot for meeting: ${meetingUrl}`,
        err?.response?.data || err?.message || err,
      );
      // Don't throw - just log and continue
    }
  }
}

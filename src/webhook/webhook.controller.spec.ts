import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { MeetingsService } from '../meetings/meetings.service';
import { CalendarWatchService } from '../providers/calendar-watch.service';

describe('WebhookController', () => {
  let controller: WebhookController;
  let meetingsService: Record<string, jest.Mock>;
  let calendarWatchService: Record<string, jest.Mock>;

  beforeEach(async () => {
    meetingsService = {
      updateMeetingFromBotState: jest.fn(),
      handleTranscriptUpdate: jest.fn(),
    };

    calendarWatchService = {
      handleNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: MeetingsService, useValue: meetingsService },
        { provide: CalendarWatchService, useValue: calendarWatchService },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /webhook/bots', () => {
    it('should call updateMeetingFromBotState when trigger is bot.state_change', async () => {
      const payload = {
        trigger: 'bot.state_change',
        bot_id: 'bot-123',
        data: { new_state: 'live' },
      };
      meetingsService.updateMeetingFromBotState.mockResolvedValue(undefined);

      const result = await controller.handleBotWebhook(payload);

      expect(meetingsService.updateMeetingFromBotState).toHaveBeenCalledWith(
        payload,
      );
      expect(result).toEqual({ success: true });
    });

    it('should call handleTranscriptUpdate when trigger is transcript.update', async () => {
      const payload = {
        trigger: 'transcript.update',
        bot_id: 'bot-456',
        data: { transcript: 'Hello world' },
      };
      meetingsService.handleTranscriptUpdate.mockResolvedValue(undefined);

      const result = await controller.handleBotWebhook(payload);

      expect(meetingsService.handleTranscriptUpdate).toHaveBeenCalledWith(
        payload,
      );
      expect(result).toEqual({ success: true });
    });

    it('should return success true for unknown trigger types', async () => {
      const payload = {
        trigger: 'unknown.trigger',
        bot_id: 'bot-789',
        data: {},
      };

      const result = await controller.handleBotWebhook(payload);

      expect(meetingsService.updateMeetingFromBotState).not.toHaveBeenCalled();
      expect(meetingsService.handleTranscriptUpdate).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should return success false with error message when bot.state_change throws', async () => {
      const payload = {
        trigger: 'bot.state_change',
        bot_id: 'bot-err',
        data: {},
      };
      meetingsService.updateMeetingFromBotState.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const result = await controller.handleBotWebhook(payload);

      expect(result).toEqual({
        success: false,
        error: 'DB connection lost',
      });
    });

    it('should not await handleTranscriptUpdate (fire-and-forget) and still return success', async () => {
      const payload = {
        trigger: 'transcript.update',
        bot_id: 'bot-async',
        data: { transcript: 'test' },
      };
      // Simulate an async rejection that would be caught by .catch()
      meetingsService.handleTranscriptUpdate.mockReturnValue(
        Promise.reject(new Error('Transcript processing failed')),
      );

      const result = await controller.handleBotWebhook(payload);

      // Should still return success because the error is caught in .catch()
      expect(result).toEqual({ success: true });
    });
  });

  describe('GET /webhook/bot-test', () => {
    it('should return "Controller is working"', async () => {
      const result = await controller.testRoute();
      expect(result).toBe('Controller is working');
    });
  });

  describe('POST /webhook/calendar', () => {
    it('should extract Google headers and call calendarWatchService.handleNotification', async () => {
      const headers = {
        'x-goog-channel-id': 'channel-123',
        'x-goog-resource-id': 'resource-456',
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': '5',
        'x-goog-channel-token': 'token-789',
        'x-goog-channel-expiration': '2025-01-01T00:00:00Z',
      };
      calendarWatchService.handleNotification.mockResolvedValue(undefined);

      await controller.handleCalendarWebhook(headers);

      expect(calendarWatchService.handleNotification).toHaveBeenCalledWith({
        'x-goog-channel-id': 'channel-123',
        'x-goog-resource-id': 'resource-456',
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': '5',
        'x-goog-channel-token': 'token-789',
        'x-goog-channel-expiration': '2025-01-01T00:00:00Z',
      });
    });

    it('should not throw when calendarWatchService.handleNotification rejects (fire-and-forget)', async () => {
      const headers = {
        'x-goog-channel-id': 'channel-err',
        'x-goog-resource-id': 'resource-err',
        'x-goog-resource-state': 'exists',
      };
      calendarWatchService.handleNotification.mockReturnValue(
        Promise.reject(new Error('Calendar sync failed')),
      );

      // Should not throw because the error is caught in .catch()
      await expect(
        controller.handleCalendarWebhook(headers),
      ).resolves.toBeUndefined();
    });
  });
});

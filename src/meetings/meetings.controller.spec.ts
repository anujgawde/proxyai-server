import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { FirebaseAuthGuard } from '../auth/guards/firebae-auth.guard';
import { createMockDecodedIdToken } from '../test/test-helpers';
import { MeetingStatus } from '../entities/meeting.entity';
import { Observable, of } from 'rxjs';

describe('MeetingsController', () => {
  let controller: MeetingsController;
  let meetingsService: Record<string, jest.Mock>;

  const mockDecodedToken = createMockDecodedIdToken();

  beforeEach(async () => {
    meetingsService = {
      getMeetingsByStatus: jest.fn(),
      syncMeetings: jest.fn(),
      getMeetingSummaries: jest.fn(),
      getTranscriptSegments: jest.fn(),
      getQAHistory: jest.fn(),
      askQuestion: jest.fn(),
      getUserMeetingStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        { provide: MeetingsService, useValue: meetingsService },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MeetingsController>(MeetingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /meetings', () => {
    it('should call getMeetingsByStatus with uid and query params', async () => {
      const mockMeetings = [{ id: 1, title: 'Test' }];
      meetingsService.getMeetingsByStatus.mockResolvedValue(mockMeetings);

      const result = await controller.getMeetings(
        mockDecodedToken as any,
        MeetingStatus.SCHEDULED,
        2,
        20,
      );

      expect(meetingsService.getMeetingsByStatus).toHaveBeenCalledWith(
        mockDecodedToken.uid,
        { status: MeetingStatus.SCHEDULED, page: 2, limit: 20 },
      );
      expect(result).toEqual(mockMeetings);
    });

    it('should default page to 1 and limit to 10 when not provided', async () => {
      meetingsService.getMeetingsByStatus.mockResolvedValue([]);

      await controller.getMeetings(
        mockDecodedToken as any,
        MeetingStatus.PAST,
        undefined,
        undefined,
      );

      expect(meetingsService.getMeetingsByStatus).toHaveBeenCalledWith(
        mockDecodedToken.uid,
        { status: MeetingStatus.PAST, page: 1, limit: 10 },
      );
    });
  });

  describe('POST /meetings/sync', () => {
    it('should extract access tokens from headers and call syncMeetings', async () => {
      const headers = {
        'x-zoom-access-token': 'zoom-token-123',
        'x-google-access-token': 'google-token-456',
        'x-microsoft-access-token': 'ms-token-789',
      };
      const syncResult = { google: { synced: 5 } };
      meetingsService.syncMeetings.mockResolvedValue(syncResult);

      const result = await controller.syncMeetings(
        mockDecodedToken as any,
        headers,
      );

      expect(meetingsService.syncMeetings).toHaveBeenCalledWith(
        mockDecodedToken.uid,
        {
          zoomAccessToken: 'zoom-token-123',
          googleAccessToken: 'google-token-456',
          microsoftAccessToken: 'ms-token-789',
        },
      );
      expect(result).toEqual(syncResult);
    });
  });

  describe('GET /meetings/:id/summaries', () => {
    it('should call getMeetingSummaries with id and pagination', async () => {
      const mockSummaries = { data: [], total: 0 };
      meetingsService.getMeetingSummaries.mockResolvedValue(mockSummaries);

      const result = await controller.getMeetingSummaries('42', 2, 5);

      expect(meetingsService.getMeetingSummaries).toHaveBeenCalledWith(
        '42',
        2,
        5,
      );
      expect(result).toEqual(mockSummaries);
    });
  });

  describe('GET /meetings/:id/transcript-segments', () => {
    it('should call getTranscriptSegments with parsed id, uid, and pagination', async () => {
      const mockSegments = { data: [], total: 0 };
      meetingsService.getTranscriptSegments.mockResolvedValue(mockSegments);

      const result = await controller.getMeetingTranscriptSegments(
        '10',
        3,
        25,
        mockDecodedToken as any,
      );

      expect(meetingsService.getTranscriptSegments).toHaveBeenCalledWith(
        10,
        mockDecodedToken.uid,
        3,
        25,
      );
      expect(result).toEqual(mockSegments);
    });
  });

  describe('GET /meetings/:id/qa-history', () => {
    it('should call getQAHistory with parsed id, uid, and pagination', async () => {
      const mockHistory = { data: [], total: 0 };
      meetingsService.getQAHistory.mockResolvedValue(mockHistory);

      const result = await controller.getQAHistory(
        '7',
        1,
        10,
        mockDecodedToken as any,
      );

      expect(meetingsService.getQAHistory).toHaveBeenCalledWith(
        7,
        mockDecodedToken.uid,
        1,
        10,
      );
      expect(result).toEqual(mockHistory);
    });
  });

  describe('POST /meetings/:id/ask-question', () => {
    it('should call askQuestion with parsed id, uid, and trimmed question', async () => {
      const mockAnswer = { id: 1, question: 'What?', answer: 'Something' };
      meetingsService.askQuestion.mockResolvedValue(mockAnswer);

      const result = await controller.askQuestion(
        '5',
        { question: '  What was discussed?  ' },
        mockDecodedToken as any,
      );

      expect(meetingsService.askQuestion).toHaveBeenCalledWith(
        5,
        mockDecodedToken.uid,
        'What was discussed?',
      );
      expect(result).toEqual(mockAnswer);
    });

    it('should throw BadRequestException when question is empty', async () => {
      await expect(
        controller.askQuestion(
          '5',
          { question: '   ' },
          mockDecodedToken as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when question exceeds 500 characters', async () => {
      const longQuestion = 'a'.repeat(501);

      await expect(
        controller.askQuestion(
          '5',
          { question: longQuestion },
          mockDecodedToken as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('SSE /meetings/sse', () => {
    it('should call getUserMeetingStream with userId query param', () => {
      const mockObservable = of({ data: 'test' });
      meetingsService.getUserMeetingStream.mockReturnValue(mockObservable);

      const result = controller.streamMeetings('user-123');

      expect(meetingsService.getUserMeetingStream).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result).toBe(mockObservable);
    });

    it('should throw BadRequestException when userId is not provided', () => {
      expect(() => controller.streamMeetings('')).toThrow(
        BadRequestException,
      );
    });
  });
});

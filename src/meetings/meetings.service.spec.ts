import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MeetingsService } from './meetings.service';
import { Meeting, MeetingStatus } from '../entities/meeting.entity';
import { User } from '../entities/user.entity';
import { TranscriptSegment } from '../entities/transcript-segment.entity';
import { QAEntry } from '../entities/qa-entry.entity';
import { Summary } from '../entities/summary.entity';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { RAGService } from '../rag/rag.service';
import { MeetingStreamService } from './services/meeting-stream.service';
import { MeetingStateMachine } from './states';
import {
  createMockRepository,
  createMockMeeting,
  createMockUser,
} from '../test/test-helpers';

describe('MeetingsService', () => {
  let service: MeetingsService;
  let meetingsRepo: ReturnType<typeof createMockRepository>;
  let usersRepo: ReturnType<typeof createMockRepository>;
  let segmentRepo: ReturnType<typeof createMockRepository>;
  let qaRepo: ReturnType<typeof createMockRepository>;
  let summariesRepo: ReturnType<typeof createMockRepository>;
  let mockTranscriptsService: any;
  let mockRAGService: any;
  let mockStreamService: any;
  let mockStateMachine: any;

  beforeEach(async () => {
    meetingsRepo = createMockRepository();
    usersRepo = createMockRepository();
    segmentRepo = createMockRepository();
    qaRepo = createMockRepository();
    summariesRepo = createMockRepository();

    mockTranscriptsService = {
      addTranscript: jest.fn().mockResolvedValue(undefined),
    };

    mockRAGService = {
      askQuestion: jest.fn().mockResolvedValue({
        id: 1,
        answer: 'Test answer',
        status: 'answered',
      }),
    };

    mockStreamService = {
      getUserMeetingStream: jest.fn(),
      emitMeetingStatusUpdate: jest.fn(),
      transcriptEventsSubject: { next: jest.fn() },
      summaryEventsSubject: { next: jest.fn() },
    };

    mockStateMachine = {
      transitionFromBotState: jest.fn().mockResolvedValue({
        success: true,
        previousStatus: MeetingStatus.SCHEDULED,
        newStatus: MeetingStatus.LIVE,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: getRepositoryToken(Meeting), useValue: meetingsRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(TranscriptSegment), useValue: segmentRepo },
        { provide: getRepositoryToken(QAEntry), useValue: qaRepo },
        { provide: getRepositoryToken(Summary), useValue: summariesRepo },
        { provide: TranscriptsService, useValue: mockTranscriptsService },
        { provide: RAGService, useValue: mockRAGService },
        { provide: MeetingStreamService, useValue: mockStreamService },
        { provide: MeetingStateMachine, useValue: mockStateMachine },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  describe('getMeetingById', () => {
    it('should return meeting when found and not deleted', async () => {
      const meeting = createMockMeeting();
      meetingsRepo.findOne.mockResolvedValueOnce(meeting);

      const result = await service.getMeetingById(1);

      expect(result).toBe(meeting);
      expect(meetingsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 1, isDeleted: false },
      });
    });

    it('should return null when meeting not found', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.getMeetingById(999);

      expect(result).toBeNull();
    });
  });

  describe('getMeetingsByStatus', () => {
    it('should throw when user not found', async () => {
      usersRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getMeetingsByStatus('uid-1', {
          status: MeetingStatus.SCHEDULED,
        }),
      ).rejects.toThrow('User not found');
    });

    it('should return empty array when no meetings found', async () => {
      usersRepo.findOne.mockResolvedValueOnce(createMockUser());
      meetingsRepo.queryBuilder.getMany.mockResolvedValueOnce([]);

      const result = await service.getMeetingsByStatus('uid-1', {
        status: MeetingStatus.SCHEDULED,
      });

      expect(result).toEqual([]);
    });

    it('should order PAST meetings by start_time DESC', async () => {
      usersRepo.findOne.mockResolvedValueOnce(createMockUser());
      meetingsRepo.queryBuilder.getMany.mockResolvedValueOnce([
        createMockMeeting(),
      ]);
      summariesRepo.queryBuilder.getRawMany.mockResolvedValueOnce([]);

      await service.getMeetingsByStatus('uid-1', {
        status: MeetingStatus.PAST,
      });

      expect(meetingsRepo.queryBuilder.orderBy).toHaveBeenCalledWith(
        'meeting.start_time',
        'DESC',
      );
    });

    it('should order non-PAST meetings by start_time ASC', async () => {
      usersRepo.findOne.mockResolvedValueOnce(createMockUser());
      meetingsRepo.queryBuilder.getMany.mockResolvedValueOnce([
        createMockMeeting(),
      ]);
      summariesRepo.queryBuilder.getRawMany.mockResolvedValueOnce([]);

      await service.getMeetingsByStatus('uid-1', {
        status: MeetingStatus.SCHEDULED,
      });

      expect(meetingsRepo.queryBuilder.orderBy).toHaveBeenCalledWith(
        'meeting.start_time',
        'ASC',
      );
    });

    it('should attach latest summary to each meeting', async () => {
      usersRepo.findOne.mockResolvedValueOnce(createMockUser());
      const meeting = createMockMeeting({ id: 1 });
      meetingsRepo.queryBuilder.getMany.mockResolvedValueOnce([meeting]);
      summariesRepo.queryBuilder.getRawMany.mockResolvedValueOnce([
        { meeting_id: 1, content: 'Latest summary' },
      ]);

      const result = await service.getMeetingsByStatus('uid-1', {
        status: MeetingStatus.PAST,
      });

      expect(result[0].latestSummary).toBe('Latest summary');
    });
  });

  describe('syncMeetings', () => {
    it('should return unsupported message for zoom', async () => {
      const result = await service.syncMeetings('uid-1', {
        zoomAccessToken: 'token',
      });

      expect(result.zoom.message).toContain('does not support Zoom Calendar');
    });

    it('should return unsupported message for microsoft', async () => {
      const result = await service.syncMeetings('uid-1', {
        microsoftAccessToken: 'token',
      });

      expect(result.microsoft.message).toContain(
        'does not support Microsoft Calendar',
      );
    });

    it('should return empty results when no tokens provided', async () => {
      const result = await service.syncMeetings('uid-1', {});

      expect(result).toEqual({});
    });
  });

  describe('updateMeetingFromBotState', () => {
    it('should return early when meeting not found for bot_id', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(null);

      await service.updateMeetingFromBotState({
        bot_id: 'bot-999',
        data: { new_state: 'joining' },
      } as any);

      expect(mockStateMachine.transitionFromBotState).not.toHaveBeenCalled();
    });

    it('should call meetingStateMachine.transitionFromBotState', async () => {
      const meeting = createMockMeeting({
        status: MeetingStatus.SCHEDULED,
        userId: 'user-1',
      });
      meetingsRepo.findOne.mockResolvedValueOnce(meeting);

      await service.updateMeetingFromBotState({
        bot_id: 'bot-123',
        data: { new_state: 'joining' },
      } as any);

      expect(mockStateMachine.transitionFromBotState).toHaveBeenCalledWith(
        meeting,
        'joining',
      );
    });

    it('should save meeting and emit status update when status changed', async () => {
      const meeting = createMockMeeting({
        status: MeetingStatus.SCHEDULED,
        userId: 'user-1',
      });
      meetingsRepo.findOne.mockResolvedValueOnce(meeting);

      await service.updateMeetingFromBotState({
        bot_id: 'bot-123',
        data: { new_state: 'joining' },
      } as any);

      expect(meetingsRepo.save).toHaveBeenCalledWith(meeting);
      expect(mockStreamService.emitMeetingStatusUpdate).toHaveBeenCalled();
    });

    it('should not save when transition fails', async () => {
      const meeting = createMockMeeting();
      meetingsRepo.findOne.mockResolvedValueOnce(meeting);
      mockStateMachine.transitionFromBotState.mockResolvedValueOnce({
        success: false,
        error: 'Invalid transition',
        previousStatus: MeetingStatus.PAST,
        newStatus: MeetingStatus.PAST,
      });

      await service.updateMeetingFromBotState({
        bot_id: 'bot-123',
        data: { new_state: 'joining' },
      } as any);

      expect(meetingsRepo.save).not.toHaveBeenCalled();
    });

    it('should not save when previous and new status are same', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      meetingsRepo.findOne.mockResolvedValueOnce(meeting);
      mockStateMachine.transitionFromBotState.mockResolvedValueOnce({
        success: true,
        previousStatus: MeetingStatus.LIVE,
        newStatus: MeetingStatus.LIVE,
      });

      await service.updateMeetingFromBotState({
        bot_id: 'bot-123',
        data: { new_state: 'joining' },
      } as any);

      expect(meetingsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('handleTranscriptUpdate', () => {
    it('should find meeting by bot_id and call transcriptsService.addTranscript', async () => {
      const meeting = createMockMeeting();
      meetingsRepo.findOne.mockResolvedValueOnce(meeting);

      await service.handleTranscriptUpdate({
        bot_id: 'bot-123',
        data: { speaker_name: 'Alice' },
      });

      expect(mockTranscriptsService.addTranscript).toHaveBeenCalledWith(
        meeting,
        { speaker_name: 'Alice' },
      );
    });

    it('should return early when meeting not found', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(null);

      await service.handleTranscriptUpdate({
        bot_id: 'bot-999',
        data: {},
      });

      expect(mockTranscriptsService.addTranscript).not.toHaveBeenCalled();
    });
  });

  describe('getMeetingSummaries', () => {
    it('should return paginated summaries ordered by createdAt DESC', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(createMockMeeting());
      const summaries = [{ id: 1, content: 'Summary 1' }];
      summariesRepo.findAndCount.mockResolvedValueOnce([summaries, 1]);

      const result = await service.getMeetingSummaries('1', 1, 10);

      expect(result.data).toEqual(summaries);
      expect(result.pagination.total).toBe(1);
      expect(summariesRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('getTranscriptSegments', () => {
    it('should throw when meeting not found or unauthorized', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getTranscriptSegments(1, 'user-1'),
      ).rejects.toThrow('Meeting not found or unauthorized');
    });

    it('should return paginated transcript segments', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(createMockMeeting());
      const segments = [{ id: 1, transcript: 'Hello' }];
      segmentRepo.findAndCount.mockResolvedValueOnce([segments, 1]);

      const result = await service.getTranscriptSegments(1, 'user-1');

      expect(result.data).toEqual(segments);
    });
  });

  describe('askQuestion', () => {
    it('should throw when meeting not found or unauthorized', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.askQuestion(1, 'user-1', 'What happened?'),
      ).rejects.toThrow('Meeting not found or unauthorized');
    });

    it('should throw when no transcripts available', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(createMockMeeting());
      segmentRepo.count.mockResolvedValueOnce(0);

      await expect(
        service.askQuestion(1, 'user-1', 'What happened?'),
      ).rejects.toThrow('No transcripts available for this meeting yet');
    });

    it('should call ragService.askQuestion and return result', async () => {
      meetingsRepo.findOne.mockResolvedValueOnce(createMockMeeting());
      segmentRepo.count.mockResolvedValueOnce(5);

      const result = await service.askQuestion(1, 'user-1', 'What happened?');

      expect(mockRAGService.askQuestion).toHaveBeenCalledWith(
        1,
        'user-1',
        'What happened?',
      );
      expect(result.answer).toBe('Test answer');
    });
  });
});

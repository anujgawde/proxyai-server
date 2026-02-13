import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TranscriptsService } from './transcripts.service';
import { TranscriptEntry } from '../entities/transcript-entry.entity';
import { TranscriptSegment } from '../entities/transcript-segment.entity';
import { Summary } from '../entities/summary.entity';
import { GeminiService } from '../gemini/gemini.service';
import { RAGService } from '../rag/rag.service';
import { MeetingsService } from '../meetings/meetings.service';
import {
  createMockRepository,
  createMockMeeting,
} from '../test/test-helpers';
import { Subject } from 'rxjs';

describe('TranscriptsService', () => {
  let service: TranscriptsService;
  let transcriptRepo: ReturnType<typeof createMockRepository>;
  let segmentRepo: ReturnType<typeof createMockRepository>;
  let summaryRepo: ReturnType<typeof createMockRepository>;
  let mockGeminiService: any;
  let mockRAGService: any;
  let mockMeetingsService: any;

  beforeEach(async () => {
    jest.useFakeTimers();

    transcriptRepo = createMockRepository();
    segmentRepo = createMockRepository();
    summaryRepo = createMockRepository();

    mockGeminiService = {
      generateSummary: jest.fn().mockResolvedValue('Test summary'),
    };

    mockRAGService = {
      storeTranscripts: jest.fn().mockResolvedValue(undefined),
    };

    mockMeetingsService = {
      getMeetingById: jest.fn().mockResolvedValue(createMockMeeting()),
      transcriptEvents$: new Subject(),
      summaryEvent$: new Subject(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptsService,
        { provide: getRepositoryToken(TranscriptEntry), useValue: transcriptRepo },
        { provide: getRepositoryToken(TranscriptSegment), useValue: segmentRepo },
        { provide: getRepositoryToken(Summary), useValue: summaryRepo },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: RAGService, useValue: mockRAGService },
        { provide: MeetingsService, useValue: mockMeetingsService },
      ],
    }).compile();

    service = module.get<TranscriptsService>(TranscriptsService);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await service.onModuleDestroy();
  });

  describe('addTranscript', () => {
    const meeting = createMockMeeting({ id: 1, userId: 'user-1' });
    const transcriptData = {
      speaker_name: 'Alice',
      speaker_uuid: 'uuid-1',
      speaker_user_uuid: 'user-uuid-1',
      speaker_is_host: true,
      timestamp_ms: 1705312800000,
      duration_ms: '5000',
      transcription: { transcript: 'Hello world', words: 2 },
    };

    it('should save a TranscriptSegment to the repository', async () => {
      segmentRepo.save.mockResolvedValueOnce({});

      await service.addTranscript(meeting, transcriptData);

      expect(segmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 1,
          speakerName: 'Alice',
          transcript: 'Hello world',
        }),
      );
      expect(segmentRepo.save).toHaveBeenCalled();
    });

    it('should emit transcript event via SSE subject', async () => {
      const events: any[] = [];
      mockMeetingsService.transcriptEvents$.subscribe((e: any) => events.push(e));

      await service.addTranscript(meeting, transcriptData);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('transcript_update');
      expect(events[0].userId).toBe('user-1');
    });

    it('should initialize a new buffer for a meeting on first transcript', async () => {
      expect(service.getBufferStats().activeMeetings).toBe(0);

      await service.addTranscript(meeting, transcriptData);

      expect(service.getBufferStats().activeMeetings).toBe(1);
    });

    it('should start a flush interval for new meeting buffer', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      await service.addTranscript(meeting, transcriptData);

      expect(setIntervalSpy).toHaveBeenCalled();
    });

    it('should append to existing buffer for same meeting', async () => {
      await service.addTranscript(meeting, transcriptData);
      await service.addTranscript(meeting, {
        ...transcriptData,
        speaker_name: 'Bob',
      });

      expect(service.getBufferStats().totalBufferedTranscripts).toBe(2);
      expect(service.getBufferStats().activeMeetings).toBe(1);
    });

    it('should not start duplicate flush interval for same meeting', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      await service.addTranscript(meeting, transcriptData);
      await service.addTranscript(meeting, transcriptData);

      const meetingIntervalCalls = setIntervalSpy.mock.calls.filter(
        (call) => call[1] === 60000,
      );
      expect(meetingIntervalCalls).toHaveLength(1);
    });
  });

  describe('flushMeetingBuffer', () => {
    const meeting = createMockMeeting({ id: 1 });
    const transcriptData = {
      speaker_name: 'Alice',
      speaker_uuid: 'uuid-1',
      speaker_user_uuid: 'user-uuid-1',
      speaker_is_host: true,
      timestamp_ms: 1705312800000,
      duration_ms: '5000',
      transcription: { transcript: 'Hello', words: 1 },
    };

    it('should skip flush when buffer is empty', async () => {
      await service.flushMeetingBuffer(999);

      expect(transcriptRepo.save).not.toHaveBeenCalled();
    });

    it('should save transcript entry with correct data', async () => {
      await service.addTranscript(meeting, transcriptData);

      await service.flushMeetingBuffer(1);

      expect(transcriptRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 1,
        }),
      );
      expect(transcriptRepo.save).toHaveBeenCalled();
    });

    it('should reset buffer after flushing', async () => {
      await service.addTranscript(meeting, transcriptData);
      expect(service.getBufferStats().totalBufferedTranscripts).toBe(1);

      await service.flushMeetingBuffer(1);

      expect(service.getBufferStats().totalBufferedTranscripts).toBe(0);
    });

    it('should clear buffer when meeting not found', async () => {
      await service.addTranscript(meeting, transcriptData);
      mockMeetingsService.getMeetingById.mockResolvedValueOnce(null);

      await service.flushMeetingBuffer(1);

      expect(service.getBufferStats().activeMeetings).toBe(0);
    });

    it('should remove meetingId from processingMeetings in finally block', async () => {
      await service.addTranscript(meeting, transcriptData);
      mockMeetingsService.getMeetingById.mockRejectedValueOnce(
        new Error('DB error'),
      );

      await service.flushMeetingBuffer(1);

      expect(service.getBufferStats().processingCount).toBe(0);
    });

    it('should skip flush when meeting is already being processed', async () => {
      await service.addTranscript(meeting, transcriptData);

      let resolveGetMeeting: any;
      mockMeetingsService.getMeetingById.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveGetMeeting = resolve;
        }),
      );

      const firstFlush = service.flushMeetingBuffer(1);

      await service.addTranscript(meeting, transcriptData);
      await service.flushMeetingBuffer(1);

      resolveGetMeeting(createMockMeeting());
      await firstFlush;

      expect(transcriptRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushAndClearMeeting', () => {
    it('should flush buffer then clear interval and buffer maps', async () => {
      const meeting = createMockMeeting({ id: 1 });
      const transcriptData = {
        speaker_name: 'Alice',
        speaker_uuid: 'uuid-1',
        speaker_user_uuid: 'user-uuid-1',
        speaker_is_host: true,
        timestamp_ms: 1705312800000,
        duration_ms: '5000',
        transcription: { transcript: 'Hello', words: 1 },
      };

      await service.addTranscript(meeting, transcriptData);
      expect(service.getBufferStats().activeMeetings).toBe(1);

      await service.flushAndClearMeeting(1);

      expect(service.getBufferStats().activeMeetings).toBe(0);
      expect(service.getBufferStats().processingCount).toBe(0);
    });
  });

  describe('getBufferStats', () => {
    it('should return correct counts for active meetings and buffered transcripts', async () => {
      const meeting1 = createMockMeeting({ id: 1, userId: 'user-1' });
      const meeting2 = createMockMeeting({ id: 2, userId: 'user-2' });
      const transcriptData = {
        speaker_name: 'Alice',
        speaker_uuid: 'uuid-1',
        speaker_user_uuid: 'user-uuid-1',
        speaker_is_host: true,
        timestamp_ms: 1705312800000,
        duration_ms: '5000',
        transcription: { transcript: 'Hello', words: 1 },
      };

      await service.addTranscript(meeting1, transcriptData);
      await service.addTranscript(meeting1, transcriptData);
      await service.addTranscript(meeting2, transcriptData);

      const stats = service.getBufferStats();
      expect(stats.activeMeetings).toBe(2);
      expect(stats.totalBufferedTranscripts).toBe(3);
    });

    it('should return zero counts when no meetings are buffered', () => {
      const stats = service.getBufferStats();
      expect(stats.activeMeetings).toBe(0);
      expect(stats.totalBufferedTranscripts).toBe(0);
      expect(stats.processingCount).toBe(0);
    });
  });

  describe('onModuleDestroy', () => {
    it('should flush all active meeting buffers and clear state', async () => {
      const meeting = createMockMeeting({ id: 1, userId: 'user-1' });
      const transcriptData = {
        speaker_name: 'Alice',
        speaker_uuid: 'uuid-1',
        speaker_user_uuid: 'user-uuid-1',
        speaker_is_host: true,
        timestamp_ms: 1705312800000,
        duration_ms: '5000',
        transcription: { transcript: 'Hello', words: 1 },
      };

      await service.addTranscript(meeting, transcriptData);

      await service.onModuleDestroy();

      expect(service.getBufferStats().activeMeetings).toBe(0);
      expect(service.getBufferStats().totalBufferedTranscripts).toBe(0);
    });
  });
});

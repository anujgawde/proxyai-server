import { MeetingStateMachine } from './meeting-state-machine';
import { ScheduledState } from './scheduled.state';
import { LiveState } from './live.state';
import { PastState } from './past.state';
import { MeetingStatus } from '../../entities/meeting.entity';
import { createMockMeeting } from '../../test/test-helpers';
import { TranscriptsService } from '../../transcripts/transcripts.service';

describe('MeetingStateMachine', () => {
  let stateMachine: MeetingStateMachine;
  let scheduledState: ScheduledState;
  let liveState: LiveState;
  let pastState: PastState;
  let mockTranscriptsService: jest.Mocked<Partial<TranscriptsService>>;

  beforeEach(() => {
    mockTranscriptsService = {
      flushAndClearMeeting: jest.fn().mockResolvedValue(undefined),
    };

    scheduledState = new ScheduledState();
    liveState = new LiveState();
    pastState = new PastState(
      mockTranscriptsService as unknown as TranscriptsService,
    );

    stateMachine = new MeetingStateMachine(
      scheduledState,
      liveState,
      pastState,
    );
  });

  describe('canTransition', () => {
    it('should allow SCHEDULED -> LIVE', () => {
      expect(
        stateMachine.canTransition(MeetingStatus.SCHEDULED, MeetingStatus.LIVE),
      ).toBe(true);
    });

    it('should allow SCHEDULED -> CANCELLED', () => {
      expect(
        stateMachine.canTransition(
          MeetingStatus.SCHEDULED,
          MeetingStatus.CANCELLED,
        ),
      ).toBe(true);
    });

    it('should allow SCHEDULED -> NO_SHOW', () => {
      expect(
        stateMachine.canTransition(
          MeetingStatus.SCHEDULED,
          MeetingStatus.NO_SHOW,
        ),
      ).toBe(true);
    });

    it('should allow LIVE -> PAST', () => {
      expect(
        stateMachine.canTransition(MeetingStatus.LIVE, MeetingStatus.PAST),
      ).toBe(true);
    });

    it('should reject SCHEDULED -> PAST (invalid skip)', () => {
      expect(
        stateMachine.canTransition(
          MeetingStatus.SCHEDULED,
          MeetingStatus.PAST,
        ),
      ).toBe(false);
    });

    it('should reject LIVE -> SCHEDULED (no backward)', () => {
      expect(
        stateMachine.canTransition(
          MeetingStatus.LIVE,
          MeetingStatus.SCHEDULED,
        ),
      ).toBe(false);
    });

    it('should reject LIVE -> CANCELLED', () => {
      expect(
        stateMachine.canTransition(
          MeetingStatus.LIVE,
          MeetingStatus.CANCELLED,
        ),
      ).toBe(false);
    });

    it('should reject PAST -> any (terminal state)', () => {
      expect(
        stateMachine.canTransition(MeetingStatus.PAST, MeetingStatus.LIVE),
      ).toBe(false);
      expect(
        stateMachine.canTransition(
          MeetingStatus.PAST,
          MeetingStatus.SCHEDULED,
        ),
      ).toBe(false);
    });

    it('should return false for unknown source state', () => {
      expect(
        stateMachine.canTransition(
          'unknown' as MeetingStatus,
          MeetingStatus.LIVE,
        ),
      ).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('should return [LIVE, CANCELLED, NO_SHOW] for SCHEDULED', () => {
      const transitions = stateMachine.getValidTransitions(
        MeetingStatus.SCHEDULED,
      );
      expect(transitions).toEqual(
        expect.arrayContaining([
          MeetingStatus.LIVE,
          MeetingStatus.CANCELLED,
          MeetingStatus.NO_SHOW,
        ]),
      );
      expect(transitions).toHaveLength(3);
    });

    it('should return [PAST] for LIVE', () => {
      const transitions = stateMachine.getValidTransitions(MeetingStatus.LIVE);
      expect(transitions).toEqual([MeetingStatus.PAST]);
    });

    it('should return [] for PAST', () => {
      const transitions = stateMachine.getValidTransitions(MeetingStatus.PAST);
      expect(transitions).toEqual([]);
    });

    it('should return [] for unknown state', () => {
      const transitions = stateMachine.getValidTransitions(
        'unknown' as MeetingStatus,
      );
      expect(transitions).toEqual([]);
    });
  });

  describe('transition', () => {
    it('should succeed for valid SCHEDULED -> LIVE transition', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const result = await stateMachine.transition(meeting, MeetingStatus.LIVE);

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(MeetingStatus.SCHEDULED);
      expect(result.newStatus).toBe(MeetingStatus.LIVE);
      expect(meeting.status).toBe(MeetingStatus.LIVE);
    });

    it('should call onExit on source state and onEnter on target state', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const onExitSpy = jest.spyOn(scheduledState, 'onExit');
      const onEnterSpy = jest.spyOn(liveState, 'onEnter');

      await stateMachine.transition(meeting, MeetingStatus.LIVE);

      expect(onExitSpy).toHaveBeenCalledWith(meeting);
      expect(onEnterSpy).toHaveBeenCalledWith(meeting);
    });

    it('should return success without changing status when already in target state', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      const result = await stateMachine.transition(meeting, MeetingStatus.LIVE);

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(MeetingStatus.LIVE);
      expect(result.newStatus).toBe(MeetingStatus.LIVE);
    });

    it('should return failure for invalid transitions', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const result = await stateMachine.transition(meeting, MeetingStatus.PAST);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
      expect(meeting.status).toBe(MeetingStatus.SCHEDULED);
    });

    it('should revert meeting.status on onEnter failure', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      jest
        .spyOn(liveState, 'onEnter')
        .mockRejectedValueOnce(new Error('onEnter failed'));

      const result = await stateMachine.transition(meeting, MeetingStatus.LIVE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('onEnter failed');
      expect(meeting.status).toBe(MeetingStatus.SCHEDULED);
    });

    it('should revert meeting.status on onExit failure', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      jest
        .spyOn(scheduledState, 'onExit')
        .mockRejectedValueOnce(new Error('onExit failed'));

      const result = await stateMachine.transition(meeting, MeetingStatus.LIVE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('onExit failed');
      expect(meeting.status).toBe(MeetingStatus.SCHEDULED);
    });

    it('should call transcriptsService.flushAndClearMeeting when transitioning to PAST', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });

      await stateMachine.transition(meeting, MeetingStatus.PAST);

      expect(mockTranscriptsService.flushAndClearMeeting).toHaveBeenCalledWith(
        meeting.id,
      );
    });

    it('should succeed even if PastState.onEnter flush fails', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      mockTranscriptsService.flushAndClearMeeting!.mockRejectedValueOnce(
        new Error('flush failed'),
      );

      // PastState.onEnter catches the error internally
      const result = await stateMachine.transition(meeting, MeetingStatus.PAST);
      expect(result.success).toBe(true);
      expect(meeting.status).toBe(MeetingStatus.PAST);
    });
  });

  describe('transitionFromBotState', () => {
    it('should map "joining" bot state to LIVE', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'joining',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.LIVE);
    });

    it('should map "joined_not_recording" bot state to LIVE', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'joined_not_recording',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.LIVE);
    });

    it('should map "joined_recording" bot state to LIVE', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'joined_recording',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.LIVE);
    });

    it('should map "post_processing" bot state to PAST', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'post_processing',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.PAST);
    });

    it('should map "ended" bot state to PAST', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'ended',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.PAST);
    });

    it('should map "left" bot state to PAST', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'left',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.PAST);
    });

    it('should map "fatal_error" bot state to PAST', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'fatal_error',
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(MeetingStatus.PAST);
    });

    it('should return error for unknown bot state', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.SCHEDULED });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'waiting_room',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown bot state');
    });

    it('should return no-op when bot state maps to current status', async () => {
      const meeting = createMockMeeting({ status: MeetingStatus.LIVE });
      const result = await stateMachine.transitionFromBotState(
        meeting,
        'joining',
      );
      // joining maps to LIVE, and meeting is already LIVE
      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(MeetingStatus.LIVE);
      expect(result.newStatus).toBe(MeetingStatus.LIVE);
    });
  });

  describe('getState', () => {
    it('should return the state handler for SCHEDULED', () => {
      expect(stateMachine.getState(MeetingStatus.SCHEDULED)).toBe(
        scheduledState,
      );
    });

    it('should return the state handler for LIVE', () => {
      expect(stateMachine.getState(MeetingStatus.LIVE)).toBe(liveState);
    });

    it('should return the state handler for PAST', () => {
      expect(stateMachine.getState(MeetingStatus.PAST)).toBe(pastState);
    });

    it('should return undefined for unregistered states', () => {
      expect(stateMachine.getState(MeetingStatus.CANCELLED)).toBeUndefined();
    });
  });
});

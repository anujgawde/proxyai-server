import { AuthProviderEnum, User } from '../entities/user.entity';
import {
  Meeting,
  MeetingStatus,
  MeetingProvider,
  CalendarProvider,
} from '../entities/meeting.entity';
import { TranscriptData } from '../entities/transcript-entry.entity';
import { Provider, ProviderOptions, WatchStatus } from '../entities/providers.entity';

/**
 * Creates a mock TypeORM repository with jest-mocked methods.
 */
export function createMockRepository() {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getRawMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
  };

  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    create: jest.fn().mockImplementation((entity) => entity),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    queryBuilder,
  };
}

/**
 * Creates a mock User entity with sensible defaults.
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    firebaseUid: 'firebase-uid-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    photoURL: null,
    authProvider: AuthProviderEnum.EMAIL,
    emailVerified: true,
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    qaEntries: [],
    ...overrides,
  } as User;
}

/**
 * Creates a mock Meeting entity with sensible defaults.
 */
export function createMockMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    title: 'Test Meeting',
    description: 'A test meeting',
    startTime: new Date('2024-01-15T10:00:00Z'),
    endTime: new Date('2024-01-15T11:00:00Z'),
    timezone: 'UTC',
    duration: 60,
    status: MeetingStatus.SCHEDULED,
    meetingUrl: 'https://meet.google.com/abc-def-ghi',
    calendarProvider: CalendarProvider.GOOGLE,
    meetingProvider: MeetingProvider.GOOGLE_MEET,
    organizerId: 'organizer-1',
    expectedParticipants: 2,
    presentParticipants: 0,
    providerMetadata: {},
    isDeleted: false,
    botId: 'bot-123',
    userId: 'firebase-uid-1',
    calendarEventId: 'cal-event-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    transcripts: [],
    transcriptSegments: [],
    summaries: [],
    qaEntries: [],
    user: createMockUser(),
    ...overrides,
  } as Meeting;
}

/**
 * Creates mock transcript data matching the webhook payload.
 */
export function createMockTranscriptData(
  overrides: Partial<TranscriptData> = {},
): TranscriptData {
  return {
    speaker_name: 'Alice',
    speaker_uuid: 'speaker-uuid-1',
    speaker_user_uuid: 'user-uuid-1',
    speaker_is_host: true,
    timestamp_ms: 1705312800000,
    duration_ms: '5000',
    transcription: { transcript: 'Hello world', words: 2 },
    ...overrides,
  };
}

/**
 * Creates a mock Firebase DecodedIdToken.
 */
export function createMockDecodedIdToken(overrides: Record<string, any> = {}) {
  return {
    uid: 'firebase-uid-1',
    email: 'test@example.com',
    email_verified: true,
    iss: 'https://securetoken.google.com/test-project',
    aud: 'test-project',
    auth_time: Math.floor(Date.now() / 1000),
    sub: 'firebase-uid-1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    firebase: {
      sign_in_provider: 'password',
      identities: {},
    },
    ...overrides,
  };
}

/**
 * Creates a mock Provider entity.
 */
export function createMockProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    userId: 'firebase-uid-1',
    providerName: ProviderOptions.google,
    refreshToken: 'mock-refresh-token',
    isConnected: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastSyncedAt: null,
    watchChannelId: null,
    watchResourceId: null,
    syncToken: null,
    watchExpiresAt: null,
    watchStatus: null,
    lastMessageNumber: 0,
    ...overrides,
  } as Provider;
}

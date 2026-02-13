import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MeetingsScheduler } from './meetings.scheduler';
import { MeetingsService } from './meetings.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { Provider, ProviderOptions } from '../entities/providers.entity';
import {
  createMockRepository,
  createMockProvider,
} from '../test/test-helpers';

describe('MeetingsScheduler', () => {
  let scheduler: MeetingsScheduler;
  let meetingsService: Record<string, jest.Mock>;
  let providerRegistry: Record<string, jest.Mock>;
  let providersRepository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    meetingsService = {
      syncMeetings: jest.fn(),
    };

    providerRegistry = {
      has: jest.fn(),
      refreshToken: jest.fn(),
    };

    providersRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsScheduler,
        { provide: MeetingsService, useValue: meetingsService },
        { provide: ProviderRegistryService, useValue: providerRegistry },
        {
          provide: getRepositoryToken(Provider),
          useValue: providersRepository,
        },
      ],
    }).compile();

    scheduler = module.get<MeetingsScheduler>(MeetingsScheduler);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('syncMeetingsCron', () => {
    it('should process providers in batches and sync meetings', async () => {
      const googleProvider = createMockProvider({
        id: 1,
        userId: 'user-1',
        providerName: ProviderOptions.google,
        refreshToken: 'refresh-google-1',
      });

      // First batch returns one provider, second batch returns empty (end loop)
      providersRepository.queryBuilder.getMany
        .mockResolvedValueOnce([googleProvider])
        .mockResolvedValueOnce([]);

      providerRegistry.has.mockReturnValue(true);
      providerRegistry.refreshToken.mockResolvedValue({
        accessToken: 'fresh-access-token',
      });
      meetingsService.syncMeetings.mockResolvedValue({ google: { synced: 3 } });

      await scheduler.syncMeetingsCron();

      expect(providerRegistry.has).toHaveBeenCalledWith(ProviderOptions.google);
      expect(providerRegistry.refreshToken).toHaveBeenCalledWith(
        ProviderOptions.google,
        'refresh-google-1',
      );
      expect(meetingsService.syncMeetings).toHaveBeenCalledWith('user-1', {
        googleAccessToken: 'fresh-access-token',
      });
    });

    it('should refresh tokens for multiple providers and map them correctly', async () => {
      const googleProvider = createMockProvider({
        id: 1,
        userId: 'user-1',
        providerName: ProviderOptions.google,
        refreshToken: 'refresh-google',
      });
      const zoomProvider = createMockProvider({
        id: 2,
        userId: 'user-1',
        providerName: ProviderOptions.zoom,
        refreshToken: 'refresh-zoom',
      });

      providersRepository.queryBuilder.getMany
        .mockResolvedValueOnce([googleProvider, zoomProvider])
        .mockResolvedValueOnce([]);

      providerRegistry.has.mockReturnValue(true);
      providerRegistry.refreshToken
        .mockResolvedValueOnce({ accessToken: 'google-token' })
        .mockResolvedValueOnce({ accessToken: 'zoom-token' });
      meetingsService.syncMeetings.mockResolvedValue({});

      await scheduler.syncMeetingsCron();

      expect(meetingsService.syncMeetings).toHaveBeenCalledWith('user-1', {
        googleAccessToken: 'google-token',
        zoomAccessToken: 'zoom-token',
      });
    });

    it('should continue processing when a single provider token refresh fails', async () => {
      const failingProvider = createMockProvider({
        id: 1,
        userId: 'user-fail',
        providerName: ProviderOptions.google,
        refreshToken: 'bad-token',
      });
      const okProvider = createMockProvider({
        id: 2,
        userId: 'user-ok',
        providerName: ProviderOptions.google,
        refreshToken: 'good-token',
      });

      providersRepository.queryBuilder.getMany
        .mockResolvedValueOnce([failingProvider, okProvider])
        .mockResolvedValueOnce([]);

      providerRegistry.has.mockReturnValue(true);
      providerRegistry.refreshToken
        .mockRejectedValueOnce(new Error('Token expired'))
        .mockResolvedValueOnce({ accessToken: 'ok-token' });
      meetingsService.syncMeetings.mockResolvedValue({});

      await scheduler.syncMeetingsCron();

      // The failing provider should not prevent the ok provider from syncing
      expect(meetingsService.syncMeetings).toHaveBeenCalledWith('user-ok', {
        googleAccessToken: 'ok-token',
      });
      // user-fail should not have had syncMeetings called since token refresh failed
      expect(meetingsService.syncMeetings).not.toHaveBeenCalledWith(
        'user-fail',
        expect.anything(),
      );
    });

    it('should stop processing when no more providers are returned', async () => {
      providersRepository.queryBuilder.getMany.mockResolvedValueOnce([]);

      await scheduler.syncMeetingsCron();

      expect(providerRegistry.has).not.toHaveBeenCalled();
      expect(meetingsService.syncMeetings).not.toHaveBeenCalled();
    });
  });
});

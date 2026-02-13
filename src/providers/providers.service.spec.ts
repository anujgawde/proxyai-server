import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProvidersService } from './providers.service';
import { Provider, ProviderOptions } from '../entities/providers.entity';
import {
  createMockRepository,
  createMockProvider,
} from '../test/test-helpers';

describe('ProvidersService', () => {
  let service: ProvidersService;
  let providersRepository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    providersRepository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvidersService,
        {
          provide: getRepositoryToken(Provider),
          useValue: providersRepository,
        },
      ],
    }).compile();

    service = module.get<ProvidersService>(ProvidersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConnectionStatus', () => {
    it('should return connection status for all provider options with found providers', async () => {
      const mockProvider = createMockProvider({
        providerName: ProviderOptions.google,
        isConnected: true,
        createdAt: new Date('2024-06-01'),
      });
      providersRepository.find.mockResolvedValue([mockProvider]);

      const result = await service.getConnectionStatus('firebase-uid-1');

      expect(providersRepository.find).toHaveBeenCalledWith({
        where: { userId: 'firebase-uid-1' },
        select: ['providerName', 'isConnected', 'createdAt'],
      });

      // Should return all ProviderOptions (google, zoom, microsoft)
      expect(result).toHaveLength(Object.values(ProviderOptions).length);

      const googleResult = result.find((r) => r.provider === 'google');
      expect(googleResult).toEqual({
        provider: 'google',
        connected: true,
        connectedAt: new Date('2024-06-01'),
      });

      const zoomResult = result.find((r) => r.provider === 'zoom');
      expect(zoomResult).toEqual({
        provider: 'zoom',
        connected: false,
        connectedAt: null,
      });
    });

    it('should return all providers as disconnected when no providers found', async () => {
      providersRepository.find.mockResolvedValue([]);

      const result = await service.getConnectionStatus('no-providers-user');

      expect(result).toHaveLength(Object.values(ProviderOptions).length);
      result.forEach((status) => {
        expect(status.connected).toBe(false);
        expect(status.connectedAt).toBeNull();
      });
    });
  });

  describe('updateProvider', () => {
    it('should return early when updateData is empty', async () => {
      const result = await service.updateProvider(
        'user-1',
        ProviderOptions.google,
        {},
      );

      expect(result).toBeUndefined();
      expect(providersRepository.findOne).not.toHaveBeenCalled();
      expect(providersRepository.update).not.toHaveBeenCalled();
    });

    it('should return undefined when provider connection is not found', async () => {
      providersRepository.findOne.mockResolvedValue(null);

      const result = await service.updateProvider(
        'user-1',
        ProviderOptions.google,
        { isConnected: false },
      );

      expect(result).toBeUndefined();
      expect(providersRepository.update).not.toHaveBeenCalled();
    });

    it('should update provider when connection is found', async () => {
      const mockProvider = createMockProvider();
      providersRepository.findOne.mockResolvedValue(mockProvider);
      providersRepository.update.mockResolvedValue({ affected: 1 });

      const updateData = { isConnected: false };
      const result = await service.updateProvider(
        'firebase-uid-1',
        ProviderOptions.google,
        updateData,
      );

      expect(providersRepository.findOne).toHaveBeenCalledWith({
        where: [
          { userId: 'firebase-uid-1' },
          { providerName: ProviderOptions.google },
        ],
      });

      expect(providersRepository.update).toHaveBeenCalledWith(
        { userId: 'firebase-uid-1', providerName: ProviderOptions.google },
        { isConnected: false },
      );

      expect(result).toEqual({ affected: 1 });
    });
  });
});

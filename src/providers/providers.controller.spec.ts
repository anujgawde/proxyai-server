import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { ProviderRegistryService } from './provider-registry.service';
import { FirebaseAuthGuard } from '../auth/guards/firebae-auth.guard';
import { createMockDecodedIdToken } from '../test/test-helpers';
import { ProviderOptions } from '../entities/providers.entity';

describe('ProvidersController', () => {
  let controller: ProvidersController;
  let providersService: Record<string, jest.Mock>;
  let providerRegistry: Record<string, jest.Mock>;

  const mockDecodedToken = createMockDecodedIdToken();

  beforeEach(async () => {
    providersService = {
      getConnectionStatus: jest.fn(),
      updateProvider: jest.fn(),
    };

    providerRegistry = {
      handleOAuth: jest.fn(),
      getAvailableProviders: jest.fn().mockReturnValue(['google']),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProvidersController],
      providers: [
        { provide: ProvidersService, useValue: providersService },
        { provide: ProviderRegistryService, useValue: providerRegistry },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProvidersController>(ProvidersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /providers/status', () => {
    it('should call providersService.getConnectionStatus with user uid', async () => {
      const mockStatus = [
        { provider: 'google', connected: true, connectedAt: new Date() },
        { provider: 'zoom', connected: false, connectedAt: null },
      ];
      providersService.getConnectionStatus.mockResolvedValue(mockStatus);

      const result = await controller.getProviderStatus(
        mockDecodedToken as any,
      );

      expect(providersService.getConnectionStatus).toHaveBeenCalledWith(
        mockDecodedToken.uid,
      );
      expect(result).toEqual(mockStatus);
    });
  });

  describe('POST /providers/callback', () => {
    it('should call providerRegistry.handleOAuth with provider, code, and uid', async () => {
      const oauthResult = { success: true, provider: 'google' };
      providerRegistry.handleOAuth.mockResolvedValue(oauthResult);

      const result = await controller.providerCallback(
        mockDecodedToken as any,
        'auth-code-123',
        'google',
      );

      expect(providerRegistry.handleOAuth).toHaveBeenCalledWith(
        'google',
        'auth-code-123',
        mockDecodedToken.uid,
      );
      expect(result).toEqual(oauthResult);
    });

    it('should throw BadRequestException when code is missing', async () => {
      await expect(
        controller.providerCallback(
          mockDecodedToken as any,
          '',
          'google',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when provider is missing', async () => {
      await expect(
        controller.providerCallback(
          mockDecodedToken as any,
          'auth-code-123',
          '',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for disabled providers (zoom)', async () => {
      await expect(
        controller.providerCallback(
          mockDecodedToken as any,
          'auth-code-123',
          'zoom',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('PATCH /providers/:provider', () => {
    it('should call providersService.updateProvider with uid, provider, and updateData', async () => {
      const updateData = { isConnected: false };
      const updateResult = { affected: 1 };
      providersService.updateProvider.mockResolvedValue(updateResult);

      const result = await controller.updateProvider(
        mockDecodedToken as any,
        ProviderOptions.google,
        updateData,
      );

      expect(providersService.updateProvider).toHaveBeenCalledWith(
        mockDecodedToken.uid,
        ProviderOptions.google,
        updateData,
      );
      expect(result).toEqual(updateResult);
    });
  });
});

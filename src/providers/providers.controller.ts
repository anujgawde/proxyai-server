import {
  Controller,
  Post,
  Body,
  UseGuards,
  Patch,
  Param,
  Get,
  BadRequestException,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { ProvidersService } from './providers.service';
import { ProviderOptions } from 'src/entities/providers.entity';
import { ProviderRegistryService } from './provider-registry.service';

/**
 * Providers Controller
 */
@Controller('providers')
@UseGuards(FirebaseAuthGuard)
export class ProvidersController {
  // Providers that are currently disabled/not supported
  private readonly disabledProviders: Record<string, string> = {
    zoom: 'ProxyAI does not support Zoom Calendar yet - use Google Calendar to sync Zoom meetings',
    microsoft:
      'ProxyAI does not support Microsoft Calendar yet - use Google Calendar to sync Teams meetings',
  };
  constructor(
    private readonly providersService: ProvidersService,
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

  @Get('/status')
  async getProviderStatus(@CurrentUser() user: DecodedIdToken) {
    return this.providersService.getConnectionStatus(user.uid);
  }

  /**
   * Handle OAuth callback for any registered provider
   */
  @Post('/callback')
  async providerCallback(
    @CurrentUser() user: DecodedIdToken,
    @Body('code') code: string,
    @Body('provider') provider: string,
  ) {
    if (!user.uid) {
      throw new BadRequestException('User not authenticated');
    }

    if (!code) {
      throw new BadRequestException('Authorization code is required');
    }

    if (!provider) {
      throw new BadRequestException('Provider is required');
    }

    // Check if provider is temporarily disabled
    if (this.disabledProviders[provider]) {
      throw new BadRequestException(this.disabledProviders[provider]);
    }

    // Validate provider is a known type
    const providerOption = provider as ProviderOptions;
    if (!Object.values(ProviderOptions).includes(providerOption)) {
      throw new BadRequestException(
        `Unknown provider: ${provider}. Available providers: ${this.providerRegistry.getAvailableProviders().join(', ')}`,
      );
    }

    return this.providerRegistry.handleOAuth(providerOption, code, user.uid);
  }

  @Patch(':provider')
  async updateProvider(
    @CurrentUser() user: DecodedIdToken,
    @Param('provider') provider: ProviderOptions,
    @Body() updateData: any,
  ) {
    return this.providersService.updateProvider(user.uid, provider, updateData);
  }
}

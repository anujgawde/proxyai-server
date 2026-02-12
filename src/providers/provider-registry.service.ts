import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ProviderOptions } from '../entities/providers.entity';
import { IOAuthProvider, OAUTH_PROVIDERS } from './interfaces';

/**
 * Provider Registry Service
 */
@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private readonly providers = new Map<ProviderOptions, IOAuthProvider>();

  constructor(
    @Inject(OAUTH_PROVIDERS)
    private readonly oauthProviders: IOAuthProvider[],
  ) {}

  onModuleInit() {
    // Register all injected providers
    for (const provider of this.oauthProviders) {
      this.register(provider);
    }
    this.logger.log(
      `Registered ${this.providers.size} OAuth providers: ${Array.from(this.providers.keys()).join(', ')}`,
    );
  }

  /**
   * Register an OAuth provider strategy
   */
  register(provider: IOAuthProvider): void {
    if (this.providers.has(provider.providerName)) {
      this.logger.warn(
        `Provider ${provider.providerName} already registered, overwriting`,
      );
    }
    this.providers.set(provider.providerName, provider);
    this.logger.debug(`Registered OAuth provider: ${provider.providerName}`);
  }

  /**
   * Get a provider by name
   * @throws Error if provider not found
   */
  get(providerName: ProviderOptions): IOAuthProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(
        `OAuth provider '${providerName}' not registered. Available providers: ${this.getAvailableProviders().join(', ')}`,
      );
    }
    return provider;
  }

  /**
   * Check if a provider is registered
   */
  has(providerName: ProviderOptions): boolean {
    return this.providers.has(providerName);
  }

  /**
   * Get list of all registered provider names
   */
  getAvailableProviders(): ProviderOptions[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all providers that support calendar synchronization
   */
  getCalendarSyncProviders(): IOAuthProvider[] {
    return Array.from(this.providers.values()).filter((p) =>
      p.supportsCalendarSync(),
    );
  }

  /**
   * Handle OAuth callback for any registered provider
   */
  async handleOAuth(
    providerName: ProviderOptions,
    code: string,
    userId: string,
  ) {
    const provider = this.get(providerName);
    return provider.handleOAuth(code, userId);
  }

  /**
   * Refresh token for any registered provider
   */
  async refreshToken(providerName: ProviderOptions, refreshToken: string) {
    const provider = this.get(providerName);
    return provider.refreshToken(refreshToken);
  }
}

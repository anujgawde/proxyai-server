import { ProviderOptions } from '../../entities/providers.entity';

/**
 * Standardized result from OAuth token exchange
 */
export interface OAuthResult {
  success: boolean;
  provider: ProviderOptions;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/**
 * Standardized result from token refresh
 */
export interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * OAuth provider configuration
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEndpoint: string;
  authType: 'bearer' | 'basic';
  contentType: 'application/json' | 'application/x-www-form-urlencoded';
}

/**
 * Interface for OAuth provider strategies
 */
export interface IOAuthProvider {
  /**
   * The provider identifier
   */
  readonly providerName: ProviderOptions;

  /**
   * Handle OAuth callback - exchange authorization code for tokens
   * @param code Authorization code from OAuth callback
   * @param userId User ID to associate with the provider
   * @returns Standardized OAuth result
   */
  handleOAuth(code: string, userId: string): Promise<OAuthResult>;

  /**
   * Refresh an expired access token
   * @param refreshToken The refresh token
   * @returns New access token and optionally new refresh token
   */
  refreshToken(refreshToken: string): Promise<TokenRefreshResult>;

  /**
   * Check if this provider supports calendar synchronization
   */
  supportsCalendarSync(): boolean;

  /**
   * Disconnect the provider for a user
   * @param userId User ID to disconnect
   */
  disconnect?(userId: string): Promise<void>;
}

/**
 * Token for dependency injection of OAuth providers
 */
export const OAUTH_PROVIDERS = 'OAUTH_PROVIDERS';

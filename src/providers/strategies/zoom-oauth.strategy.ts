import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Provider, ProviderOptions } from '../../entities/providers.entity';
import { IOAuthProvider, OAuthResult, TokenRefreshResult } from '../interfaces';

/**
 * Zoom OAuth Strategy
 * Note: Zoom uses Basic Auth for token exchange (different from Google).
 */
@Injectable()
export class ZoomOAuthStrategy implements IOAuthProvider {
  private readonly logger = new Logger(ZoomOAuthStrategy.name);

  readonly providerName = ProviderOptions.zoom;

  private readonly tokenEndpoint = 'https://zoom.us/oauth/token';

  constructor(
    @InjectRepository(Provider)
    private readonly providersRepository: Repository<Provider>,
  ) {}

  /**
   * Handle Zoom OAuth callback - exchange code for tokens
   */
  async handleOAuth(code: string, userId: string): Promise<OAuthResult> {
    this.logger.log(
      `Zoom OAuth callback received. userId=${userId}, code=${code.substring(0, 10)}...`,
    );

    try {
      const basicAuth = this.buildBasicAuthHeader();

      const tokenRes = await axios.post(this.tokenEndpoint, null, {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.ZOOM_REDIRECT_URI,
        },
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;

      // Persist the provider connection
      await this.providersRepository.upsert(
        {
          userId,
          providerName: ProviderOptions.zoom,
          refreshToken: refresh_token,
          isConnected: true,
        },
        ['userId', 'providerName'],
      );

      this.logger.log(
        `Zoom OAuth successful. Refresh token stored for userId=${userId}`,
      );

      return {
        success: true,
        provider: ProviderOptions.zoom,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expires_in
          ? new Date(Date.now() + expires_in * 1000)
          : undefined,
      };
    } catch (err: any) {
      this.logger.error('Zoom OAuth token exchange failed');
      this.logAxiosError(err);
      throw err;
    }
  }

  /**
   * Refresh Zoom access token
   */
  async refreshToken(refreshToken: string): Promise<TokenRefreshResult> {
    try {
      const basicAuth = this.buildBasicAuthHeader();

      const res = await axios.post(this.tokenEndpoint, null, {
        params: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token,
        expiresIn: res.data.expires_in,
      };
    } catch (err: any) {
      this.logger.error('Failed to refresh Zoom access token');
      this.logAxiosError(err);
      throw err;
    }
  }

  /**
   * Zoom calendar sync is not currently supported
   * (meetings are synced via Google Calendar)
   */
  supportsCalendarSync(): boolean {
    return false;
  }

  /**
   * Disconnect Zoom provider for a user
   */
  async disconnect(userId: string): Promise<void> {
    await this.providersRepository.update(
      { userId, providerName: ProviderOptions.zoom },
      { isConnected: false },
    );
    this.logger.log(`Zoom provider disconnected for userId=${userId}`);
  }

  /**
   * Build Basic Auth header for Zoom API
   */
  private buildBasicAuthHeader(): string {
    const clientId = process.env.ZOOM_CLIENT_ID!;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET!;
    return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }

  /**
   * Log axios error details
   */
  private logAxiosError(err: any): void {
    if (err?.response) {
      this.logger.error(
        `Status: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`,
      );
    } else {
      this.logger.error(`Error: ${err?.message || err}`);
    }
  }
}

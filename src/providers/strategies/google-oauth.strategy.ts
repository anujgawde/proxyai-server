import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Provider, ProviderOptions } from '../../entities/providers.entity';
import { IOAuthProvider, OAuthResult, TokenRefreshResult } from '../interfaces';
import { CalendarWatchService } from '../calendar-watch.service';

/**
 * Google OAuth Strategy
 */
@Injectable()
export class GoogleOAuthStrategy implements IOAuthProvider {
  private readonly logger = new Logger(GoogleOAuthStrategy.name);

  readonly providerName = ProviderOptions.google;

  private readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';

  constructor(
    @InjectRepository(Provider)
    private readonly providersRepository: Repository<Provider>,
    @Inject(forwardRef(() => CalendarWatchService))
    private readonly calendarWatchService: CalendarWatchService,
  ) {}

  /**
   * Handle Google OAuth callback - exchange code for tokens
   */
  async handleOAuth(code: string, userId: string): Promise<OAuthResult> {
    this.logger.log(
      `Google OAuth callback received. userId=${userId}, code=${code.substring(0, 10)}...`,
    );

    try {
      const tokenRes = await axios.post(
        this.tokenEndpoint,
        {
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const { access_token, refresh_token, expires_in } = tokenRes.data;

      if (!refresh_token) {
        this.logger.error(
          'Google OAuth did not return refresh_token. ' +
            'Ensure prompt=consent and access_type=offline were used.',
        );
        throw new Error('No refresh token returned from Google');
      }

      // Persist the provider connection
      await this.providersRepository.upsert(
        {
          userId,
          providerName: ProviderOptions.google,
          refreshToken: refresh_token,
          lastSyncedAt: null,
          isConnected: true,
        },
        ['userId', 'providerName'],
      );

      this.logger.log(
        `Google OAuth successful. Refresh token stored for userId=${userId}`,
      );

      // Trigger post-OAuth actions asynchronously (don't block the response)
      this.triggerPostOAuthActions(userId);

      return {
        success: true,
        provider: ProviderOptions.google,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expires_in
          ? new Date(Date.now() + expires_in * 1000)
          : undefined,
      };
    } catch (err: any) {
      this.logger.error('Google OAuth token exchange failed');
      this.logAxiosError(err);
      throw err;
    }
  }

  /**
   * Refresh Google access token
   */
  async refreshToken(refreshToken: string): Promise<TokenRefreshResult> {
    try {
      const res = await axios.post(
        this.tokenEndpoint,
        {
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      return {
        accessToken: res.data.access_token,
        // Google doesn't always return a new refresh token
        refreshToken: res.data.refresh_token,
        expiresIn: res.data.expires_in,
      };
    } catch (err: any) {
      this.logger.error('Failed to refresh Google access token');
      this.logAxiosError(err);
      throw err;
    }
  }

  /**
   * Google supports calendar synchronization
   */
  supportsCalendarSync(): boolean {
    return true;
  }

  /**
   * Disconnect Google provider for a user
   */
  async disconnect(userId: string): Promise<void> {
    await this.providersRepository.update(
      { userId, providerName: ProviderOptions.google },
      { isConnected: false },
    );
    this.logger.log(`Google provider disconnected for userId=${userId}`);
  }

  /**
   * Trigger post-OAuth actions (calendar sync, watch setup)
   * These run in the background and don't block the OAuth response
   */
  private triggerPostOAuthActions(userId: string): void {
    // Sync today's meetings immediately so user has access right away
    this.calendarWatchService.syncTodaysMeetings(userId).catch((err) => {
      this.logger.error(
        `Failed to sync today's meetings for userId=${userId}`,
        err,
      );
    });

    // Setup calendar watch for real-time sync (runs in background)
    this.calendarWatchService.setupWatch(userId).catch((err) => {
      this.logger.error(
        `Failed to setup calendar watch for userId=${userId}`,
        err,
      );
    });
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

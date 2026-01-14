import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Provider, ProviderOptions } from 'src/entities/providers.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ProvidersGoogleService {
  private readonly logger = new Logger(ProvidersGoogleService.name);

  constructor(
    @InjectRepository(Provider)
    private providersRepository: Repository<Provider>,
  ) {}

  async handleOAuth(code: string, userId: string) {
    this.logger.log(
      `Google OAuth callback received. userId=${userId}, code=${code}`,
    );

    try {
      const tokenRes = await axios.post(
        'https://oauth2.googleapis.com/token',
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
      const { access_token, refresh_token } = tokenRes.data;

      if (!refresh_token) {
        this.logger.error(
          'Google OAuth did not return refresh_token. ' +
            'Ensure prompt=consent and access_type=offline were used.',
        );
        throw new Error('No refresh token returned from Google');
      }

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

      return {
        accessToken: access_token,
      };
    } catch (err: any) {
      this.logger.error('Google OAuth token exchange failed');

      if (err?.response) {
        this.logger.error(
          `Status: ${err.response.status}, Data: ${JSON.stringify(
            err.response.data,
          )}`,
        );
      } else {
        this.logger.error(`Error: ${err?.message || err}`);
      }

      throw err;
    }
  }

  async refreshGoogleToken(refreshToken: string) {
    try {
      const res = await axios.post(
        'https://oauth2.googleapis.com/token',
        {
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        },
        { headers: { 'Content-Type': 'application/json' } },
      );
      return res.data;
    } catch (err: any) {
      this.logger.error('Failed to refresh Google access token');

      if (err?.response) {
        this.logger.error(
          `Status: ${err.response.status}, Data: ${JSON.stringify(
            err.response.data,
          )}`,
        );
      } else {
        this.logger.error(`Error: ${err?.message || err}`);
      }

      throw err;
    }
  }
}

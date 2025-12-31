import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider } from '../entities/providers.entity';

@Injectable()
export class ProvidersZoomService {
  private readonly logger = new Logger(ProvidersZoomService.name);

  constructor(
    @InjectRepository(Provider)
    private providersRepo: Repository<Provider>,
  ) {}

  async handleOAuth(code: string, userId: string) {
    const clientId = process.env.ZOOM_CLIENT_ID!;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET!;
    const redirectUri = process.env.ZOOM_REDIRECT_URI!;

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );

    const tokenRes = await axios.post('https://zoom.us/oauth/token', null, {
      params: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      },
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const {
      access_token,
      refresh_token,
      expires_in,
      user_id: zoomUserId,
    } = tokenRes.data;

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await this.providersRepo.upsert(
      {
        userId: userId,
        providerName: 'zoom',
        refreshToken: refresh_token,
      },
      ['user_id', 'provider_name'],
    );

    return {
      accessToken: access_token,
      expiresAt,
    };
  }

  async refreshZoomTokens(refreshToken: string) {
    const auth = Buffer.from(
      `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`,
    ).toString('base64');

    const res = await axios.post('https://zoom.us/oauth/token', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresIn: res.data.expires_in,
    };
  }
}

import {
  Controller,
  Post,
  Body,
  UseGuards,
  Patch,
  Param,
} from '@nestjs/common';
import { ProvidersZoomService } from './providers-zoom.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { ProvidersGoogleService } from './providers-google.service';
import { ProvidersService } from './providers.service';
import { ProviderOptions } from 'src/entities/providers.entity';

@Controller('providers')
@UseGuards(FirebaseAuthGuard)
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly zoomService: ProvidersZoomService,
    private readonly googleService: ProvidersGoogleService,
  ) {}

  @Post('/callback')
  async zoomCallback(
    @CurrentUser() user: DecodedIdToken,
    @Body('code') code: string,
    @Body('provider') provider: string,
  ) {
    if (!user.uid) {
      throw new Error('User not authenticated');
    }
    if (provider === 'google_meet') {
      return this.googleService.handleOAuth(code, user.uid);
    } else if (provider === 'zoom') {
      return this.zoomService.handleOAuth(code, user.uid);
    }
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

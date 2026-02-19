import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvidersController } from './providers.controller';
import { Provider } from '../entities/providers.entity';
import { Meeting } from '../entities/meeting.entity';
import { FirebaseService } from 'src/auth/firebase.service';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { ProvidersService } from './providers.service';
import { CalendarWatchService } from './calendar-watch.service';

import { ProviderRegistryService } from './provider-registry.service';
import { GoogleOAuthStrategy } from './strategies/google-oauth.strategy';
import { ZoomOAuthStrategy } from './strategies/zoom-oauth.strategy';
import { OAUTH_PROVIDERS } from './interfaces';

// Legacy services (kept for backward compatibility during migration)
import { ProvidersZoomService } from './providers-zoom.service';
import { ProvidersGoogleService } from './providers-google.service';

@Module({
  imports: [TypeOrmModule.forFeature([Provider, Meeting])],
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    CalendarWatchService,
    FirebaseService,
    FirebaseAuthGuard,

    // OAuth Strategies
    GoogleOAuthStrategy,
    ZoomOAuthStrategy,

    // Provider Registry - injects all OAuth strategies
    {
      provide: OAUTH_PROVIDERS,
      useFactory: (
        googleStrategy: GoogleOAuthStrategy,
        zoomStrategy: ZoomOAuthStrategy,
      ) => [googleStrategy, zoomStrategy],
      inject: [GoogleOAuthStrategy, ZoomOAuthStrategy],
    },
    ProviderRegistryService,

    // Legacy services
    ProvidersZoomService,
    ProvidersGoogleService,
  ],
  exports: [CalendarWatchService, ProvidersGoogleService, ProviderRegistryService],
})
export class ProvidersModule {}

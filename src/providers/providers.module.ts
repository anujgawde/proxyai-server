import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvidersController } from './providers.controller';
import { ProvidersZoomService } from './providers-zoom.service';
import { Provider } from '../entities/providers.entity';
import { Meeting } from '../entities/meeting.entity';
import { FirebaseService } from 'src/auth/firebase.service';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { ProvidersGoogleService } from './providers-google.service';
import { ProvidersService } from './providers.service';
import { CalendarWatchService } from './calendar-watch.service';

@Module({
  imports: [TypeOrmModule.forFeature([Provider, Meeting])],
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ProvidersZoomService,
    ProvidersGoogleService,
    CalendarWatchService,
    FirebaseService,
    FirebaseAuthGuard,
  ],
  exports: [CalendarWatchService, ProvidersGoogleService],
})
export class ProvidersModule {}

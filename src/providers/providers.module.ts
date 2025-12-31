import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvidersController } from './providers.controller';
import { ProvidersZoomService } from './providers-zoom.service';
import { Provider } from '../entities/providers.entity';
import { FirebaseService } from 'src/auth/firebase.service';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { ProvidersGoogleService } from './providers-google.service';

@Module({
  imports: [TypeOrmModule.forFeature([Provider])],
  controllers: [ProvidersController],
  providers: [
    ProvidersZoomService,
    ProvidersGoogleService,
    FirebaseService,
    FirebaseAuthGuard,
  ],
})
export class ProvidersModule {}

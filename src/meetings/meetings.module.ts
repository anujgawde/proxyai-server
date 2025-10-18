import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { FirebaseAuthGuard } from 'src/auth/guards/firebae-auth.guard';
import { FirebaseService } from 'src/auth/firebase.service';
import { User } from 'src/entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from 'src/entities/meeting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Meeting])],
  controllers: [MeetingsController],
  providers: [MeetingsService, FirebaseService, FirebaseAuthGuard],
  exports: [MeetingsService],
})
export class MeetingsModule {}

import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { MeetingsModule } from 'src/meetings/meetings.module';
import { ProvidersModule } from 'src/providers/providers.module';

@Module({
  imports: [MeetingsModule, ProvidersModule],
  controllers: [WebhookController],
})
export class WebhookModule {}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeetingsService } from './meetings.service';
import { Provider } from 'src/entities/providers.entity';
import { ProvidersZoomService } from 'src/providers/providers-zoom.service';
import { ProvidersGoogleService } from 'src/providers/providers-google.service';

@Injectable()
export class MeetingsScheduler {
  private readonly logger = new Logger(MeetingsScheduler.name);

  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly providersZoomService: ProvidersZoomService,
    private readonly providersGoogleService: ProvidersGoogleService,

    @InjectRepository(Provider)
    private readonly providersRepository: Repository<Provider>,
  ) {}

  /**
   * Runs every day at 1:00 AM
   */
  @Cron('40 1 * * *')
  async syncMeetingsCron() {
    this.logger.log('Starting syncMeetingsCron');

    const BATCH_SIZE = 50;
    let lastId = 0;

    while (true) {
      const providers = await this.providersRepository
        .createQueryBuilder('provider')
        .where('provider.id > :lastId', { lastId })
        .orderBy('provider.id', 'ASC')
        .limit(BATCH_SIZE)
        .getMany();

      if (!providers.length) break;

      lastId = providers[providers.length - 1].id;

      // Group tokens by user
      const userTokenMap = new Map<
        string,
        {
          zoomAccessToken?: string;
          gmeetAccessToken?: string;
          teamsAccessToken?: string;
        }
      >();

      await Promise.allSettled(
        providers.map(async (provider) => {
          try {
            if (provider.providerName === 'zoom') {
              const { accessToken, refreshToken } =
                await this.providersZoomService.refreshZoomTokens(
                  provider.refreshToken,
                );

              // Rotate refresh token + mark synced
              await this.providersRepository.update(
                { id: provider.id },
                {
                  refreshToken,
                  lastSyncedAt: new Date(),
                },
              );

              if (!userTokenMap.has(provider.userId)) {
                userTokenMap.set(provider.userId, {});
              }

              userTokenMap.get(provider.userId)!.zoomAccessToken = accessToken;
            }

            if (provider.providerName === 'google_meet') {
              const { accessToken, refreshToken } =
                await this.providersGoogleService.refreshGoogleToken(
                  provider.refreshToken,
                );

              // Rotate refresh token + mark synced
              await this.providersRepository.update(
                { id: provider.id },
                {
                  refreshToken,
                  lastSyncedAt: new Date(),
                },
              );

              if (!userTokenMap.has(provider.userId)) {
                userTokenMap.set(provider.userId, {});
              }

              userTokenMap.get(provider.userId)!.zoomAccessToken = accessToken;
            }

            // TODO: Teams
          } catch (err) {
            this.logger.error(
              `OAuth refresh failed for provider=${provider.providerName} user=${provider.userId}`,
              err,
            );
          }
        }),
      );

      // Sync meetings per user
      for (const [firebaseUid, tokens] of userTokenMap.entries()) {
        try {
          await this.meetingsService.syncMeetings(firebaseUid, tokens);
        } catch (err) {
          this.logger.error(`Meeting sync failed for user=${firebaseUid}`, err);
        }
      }
    }

    this.logger.log('Finished syncMeetingsCron');
  }

  @Interval(15 * 60 * 1000) // every 15 minutes
  async reconcileMeetingStatusCron() {
    this.logger.log('Running reconcileMeetingStatusCron');

    // Directly update overdue meetings without loading into memory
    await this.meetingsService.reconcileMeetingStatus();
  }
}

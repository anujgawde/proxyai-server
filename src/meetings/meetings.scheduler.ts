import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeetingsService } from './meetings.service';
import { Provider, ProviderOptions } from 'src/entities/providers.entity';
import { ProvidersGoogleService } from 'src/providers/providers-google.service';

@Injectable()
export class MeetingsScheduler {
  private readonly logger = new Logger(MeetingsScheduler.name);

  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly providersGoogleService: ProvidersGoogleService,

    @InjectRepository(Provider)
    private readonly providersRepository: Repository<Provider>,
  ) {}

  // Cron Job that runs every night at 1 AM. Enable the appmodule import to make this active.
  @Cron('* 1 * * *')
  async syncMeetingsCron() {
    this.logger.log('Starting syncMeetingsCron');

    const BATCH_SIZE = 50;
    let lastId: number | null = null;

    while (true) {
      const query = this.providersRepository
        .createQueryBuilder('provider')
        .orderBy('provider.id', 'ASC')
        .limit(BATCH_SIZE);

      if (lastId !== null) {
        query
          .where('provider.id > :lastId', { lastId })
          .andWhere('is_connected = true');
      }

      const providers = await query.getMany();

      if (providers.length === 0) {
        break;
      }

      lastId = providers[providers.length - 1].id;

      // User -> User approved calendar providers
      const userTokenMap = new Map<
        string,
        {
          zoomAccessToken?: string;
          googleAccessToken?: string;
          microsoftAccessToken?: string;
        }
      >();

      await Promise.allSettled(
        providers.map(async (provider) => {
          try {
            // if (provider.providerName === 'zoom') {
            //   const { accessToken, refreshToken } =
            //     await this.providersZoomService.refreshZoomTokens(
            //       provider.refreshToken,
            //     );

            //   if (!userTokenMap.has(provider.userId)) {
            //     userTokenMap.set(provider.userId, {});
            //   }

            //   userTokenMap.get(provider.userId)!.zoomAccessToken = accessToken;
            // }

            if (provider.providerName === 'google') {
              const { access_token } =
                await this.providersGoogleService.refreshGoogleToken(
                  provider.refreshToken,
                );

              if (!userTokenMap.has(provider.userId)) {
                userTokenMap.set(provider.userId, {});
              }

              userTokenMap.get(provider.userId)!.googleAccessToken =
                access_token;
            }
          } catch (err) {
            this.logger.error(
              `OAuth refresh failed | provider=${provider.providerName} | user=${provider.userId}`,
              err instanceof Error ? err.stack : String(err),
            );
          }
        }),
      );

      // Sync meetings for all providers for each user
      for (const [firebaseUid, tokens] of userTokenMap.entries()) {
        if (
          !tokens.zoomAccessToken &&
          !tokens.googleAccessToken &&
          !tokens.microsoftAccessToken
        ) {
          continue;
        }

        try {
          this.logger.log(`Syncing meetings for user=${firebaseUid}`);
          await this.meetingsService.syncMeetings(firebaseUid, tokens);
          await this.updateProviderLastSyncedAt(firebaseUid, tokens);
        } catch (err) {
          this.logger.error(
            `Meeting sync failed for user=${firebaseUid}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }

    this.logger.log('Finished syncMeetingsCron');
  }

  // Todo: Shift to providers module.
  private async updateProviderLastSyncedAt(
    userId: string,
    tokens: {
      zoomAccessToken?: string;
      googleMeetAccessToken?: string;
      teamsAccessToken?: string;
    },
  ) {
    const providersToUpdate: ProviderOptions[] = [];

    if (tokens.zoomAccessToken) {
      providersToUpdate.push(ProviderOptions.zoom);
    }

    if (tokens.googleMeetAccessToken) {
      providersToUpdate.push(ProviderOptions.google);
    }

    if (tokens.teamsAccessToken) {
      providersToUpdate.push(ProviderOptions.microsoft);
    }

    if (providersToUpdate.length === 0) {
      return;
    }

    await this.providersRepository
      .createQueryBuilder()
      .update(Provider)
      .set({
        lastSyncedAt: () => 'NOW()',
      })
      .where('user_id = :userId', { userId })
      .andWhere('provider_name IN (:...providers)', {
        providers: providersToUpdate,
      })
      .andWhere('is_connected = true')
      .execute();
  }
}

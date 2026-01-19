import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Provider, ProviderOptions } from 'src/entities/providers.entity';
import { Repository } from 'typeorm';

export interface ProviderConnectionStatus {
  provider: string;
  connected: boolean;
  connectedAt: Date | null;
}

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(Provider)
    private providersRepository: Repository<Provider>,
  ) {}

  async getConnectionStatus(userId: string): Promise<ProviderConnectionStatus[]> {
    const providers = await this.providersRepository.find({
      where: { userId },
      select: ['providerName', 'isConnected', 'createdAt'],
    });

    return Object.values(ProviderOptions).map((providerName) => {
      const provider = providers.find((p) => p.providerName === providerName);
      return {
        provider: providerName,
        connected: provider?.isConnected ?? false,
        connectedAt: provider?.createdAt ?? null,
      };
    });
  }

  async updateProvider(
    userId: string,
    provider: ProviderOptions,
    updateData: any,
  ) {
    if (Object.keys(updateData).length === 0) {
      return;
    }

    const providerConnection = await this.providersRepository.findOne({
      where: [
        {
          userId: userId,
        },
        {
          providerName: provider,
        },
      ],
    });

    if (!providerConnection) {
      // Todo: Handle Error
      return;
    }

    return await this.providersRepository.update(
      {
        userId,
        providerName: provider,
      },
      { ...updateData },
    );
  }
}

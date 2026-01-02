import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Provider, ProviderOptions } from 'src/entities/providers.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(Provider)
    private providersRepository: Repository<Provider>,
  ) {}
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

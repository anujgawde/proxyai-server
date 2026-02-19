import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import databaseConfig from './config/database.config';
import firebaseConfig from './config/firebase.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingsModule } from './meetings/meetings.module';
import { TranscriptEntry } from './entities/transcript-entry.entity';
import { QAEntry } from './entities/qa-entry.entity';
import { RAGModule } from './rag/rag.module';
import { ProvidersModule } from './providers/providers.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? []
          : [`.env.${process.env.NODE_ENV}.local`, '.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      load: [databaseConfig, firebaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),
        ssl: {
          rejectUnauthorized: false, // Self-signed certificates
        },

        // Connection pool configuration
        extra: {
          // Maximum number of connections in the pool
          max: 50,
          // Minimum number of connections to maintain
          min: 5,
          // Maximum time to wait for a connection: 5 seconds
          connectionTimeoutMillis: 5000,
          // How long a connection can be idle before being closed: 30 seconds
          idleTimeoutMillis: 30000,
          allowExitOnIdle: true,
        },

        synchronize: false,
        logging: false,

        entities: [__dirname + '/**/*.entity{.ts,.js}'],
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    MeetingsModule,
    RAGModule,
    ProvidersModule,
    WebhookModule,
  ],
  controllers: [AppController],
  providers: [AppService, TranscriptEntry, QAEntry],
})
export class AppModule {}

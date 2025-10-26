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
import { GeminiService } from './gemini/gemini.service';
import { QAEntry } from './entities/qa-entry.entity';
import { RAGModule } from './rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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

        // Todo: Switch commented lines in production
        // synchronize: configService.get('NODE_ENV') === 'development',
        // logging: configService.get('NODE_ENV') === 'development',

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
  ],
  controllers: [AppController],
  providers: [AppService, TranscriptEntry, QAEntry, GeminiService],
})
export class AppModule {}

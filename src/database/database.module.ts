import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_DATABASE', 'postgres'),
        ssl: configService.get<boolean>('DB_SSL', false)
          ? { rejectUnauthorized: false }
          : false,
        autoLoadEntities: true,
        synchronize: !!configService.get('DB_SYNCHRONIZE'),
        migrationsRun: !!configService.get('DB_MIGRATIONS_RUN'),
      }),
    }),
  ],
})
export class DatabaseModule {}

import { Module, Global, Inject, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service.js';
import { REDIS_CLIENT } from './redis.constants.js';

/**
 * RedisModule — Global module cung cấp Redis client (ioredis) dùng chung.
 *
 * Chỉ tạo 1 connection duy nhất. Inject RedisService vào bất kỳ module nào
 * mà không cần import lại.
 *
 * Sử dụng REDIS_DB=0 cho cache chung.
 * BullMQ sử dụng BULL_REDIS_DB=1 (cấu hình riêng trong QueueModule).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const password = configService.get<string>('REDIS_PASSWORD', '');
        const db = configService.get<number>('REDIS_DB', 0);
        const keyPrefix = configService.get<string>(
          'REDIS_KEY_PREFIX',
          'capstone:',
        );

        return new Redis({
          host,
          port,
          password: password || undefined,
          db,
          keyPrefix,
          lazyConnect: false,
          retryStrategy: (times: number) => {
            if (times > 5) return null; // ngừng retry sau 5 lần
            return Math.min(times * 200, 2000);
          },
        });
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Đóng connection dùng chung — không thì app.close() xong tiến trình vẫn treo vì socket còn mở. */
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

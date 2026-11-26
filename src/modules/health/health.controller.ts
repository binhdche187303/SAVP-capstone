import { Controller, Get, OnModuleDestroy } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheckResult,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RedisService } from '../redis/redis.service.js';
import { StorageService } from '../storage/storage.service.js';
import Redis from 'ioredis';

/**
 * HealthController — Public endpoint không yêu cầu authentication.
 *
 * GET /health
 * GET /api/v1/health (với global prefix)
 *
 * Không trả về secret, credentials, hoặc config chi tiết.
 * Response chỉ chứa status và thông tin infrastructure layer.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController implements OnModuleDestroy {
  private bullRedisClient: Redis | null = null;

  constructor(
    private readonly health: HealthCheckService,
    private readonly typeOrm: TypeOrmHealthIndicator,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    const bullEnabled = this.configService.get<boolean>(
      'HEALTH_CHECK_QUEUE',
      true,
    );
    if (bullEnabled) {
      this.initBullRedisClient();
    }
  }

  /** Đóng client BullMQ-Redis riêng (lazyConnect) — không thì app.close() xong tiến trình vẫn treo. */
  async onModuleDestroy(): Promise<void> {
    const client = this.bullRedisClient;
    if (!client || client.status === 'end') return;
    // Chưa từng kết nối (lazy) thì quit() lại đi mở kết nối → chỉ cần disconnect().
    if (client.status === 'wait') {
      client.disconnect();
      return;
    }
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }

  private initBullRedisClient(): void {
    const host = this.configService.get<string>('BULL_REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('BULL_REDIS_PORT', 6379);
    const password = this.configService.get<string>('BULL_REDIS_PASSWORD', '');
    const db = this.configService.get<number>('BULL_REDIS_DB', 1);

    this.bullRedisClient = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      lazyConnect: true,
    });
  }

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary:
      'Kiểm tra tình trạng hệ thống (DB, Redis, BullMQ Redis, storage local) — public, không yêu cầu đăng nhập',
  })
  async check(): Promise<HealthCheckResult> {
    const checks: Array<() => Promise<unknown>> = [];

    // ─── DB check ──────────────────────────────────────────────────────────────
    if (this.configService.get<boolean>('HEALTH_CHECK_DB', true)) {
      checks.push(() =>
        this.typeOrm.pingCheck('database', { connection: this.dataSource }),
      );
    }

    // ─── Redis check ───────────────────────────────────────────────────────────
    if (this.configService.get<boolean>('HEALTH_CHECK_REDIS', true)) {
      checks.push(async () => {
        const pong = await this.redisService.ping();
        return {
          redis: {
            status: pong === 'PONG' ? 'up' : 'down',
          },
        };
      });
    }

    // ─── BullMQ Redis check ────────────────────────────────────────────────────
    if (
      this.configService.get<boolean>('HEALTH_CHECK_QUEUE', true) &&
      this.bullRedisClient
    ) {
      checks.push(async () => {
        const pong = await this.bullRedisClient!.ping();
        return {
          'bull-redis': {
            status: pong === 'PONG' ? 'up' : 'down',
          },
        };
      });
    }

    // ─── Storage check (chỉ khi local) ────────────────────────────────────────
    if (
      this.configService.get<boolean>('HEALTH_CHECK_STORAGE', true) &&
      this.storageService.getDriver() === 'local'
    ) {
      checks.push(async () => {
        const result = this.storageService.checkLocalStorageAccess();
        return {
          storage: {
            status: result.accessible ? 'up' : 'down',
            ...(result.error ? { error: result.error } : {}),
          },
        };
      });
    }

    return this.health.check(checks as Parameters<typeof this.health.check>[0]);
  }
}

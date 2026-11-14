import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

/**
 * RedisService — Service dùng chung cho cache/session/rate-limit.
 *
 * Lưu ý: REDIS_KEY_PREFIX đã được set ở cấp Redis client (ioredis keyPrefix),
 * nên tất cả key truyền vào đây sẽ được tự động thêm prefix.
 *
 * Không lưu password, token raw, OTP, secret vào đây trực tiếp.
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: Redis,
  ) {}

  /**
   * Lấy giá trị theo key. Trả về null nếu không tồn tại.
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Lấy giá trị và parse JSON. Trả về null nếu không tồn tại hoặc parse lỗi.
   */
  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      this.logger.warn(`Failed to parse Redis JSON for key: ${key}`);
      return null;
    }
  }

  /**
   * Lấy JSON rồi xóa key trong cùng 1 transaction (MULTI) — dùng cho giá trị dùng 1 lần
   * (state/ticket SSO). Hai request đồng thời chỉ 1 bên nhận được giá trị.
   */
  async takeJson<T>(key: string): Promise<T | null> {
    const results = await this.client.multi().get(key).del(key).exec();
    const value = results?.[0]?.[1] as string | null | undefined;
    if (value === null || value === undefined) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      this.logger.warn(`Failed to parse Redis JSON for key: ${key}`);
      return null;
    }
  }

  /**
   * Set giá trị (không TTL).
   */
  async set(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  /**
   * Set giá trị với TTL (giây).
   */
  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  /**
   * Set JSON object với TTL (giây).
   */
  async setJsonWithTtl<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /**
   * Xóa key.
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Kiểm tra key có tồn tại không.
   */
  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  /**
   * Tăng giá trị integer của key lên 1. Trả về giá trị sau khi tăng.
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Set TTL cho key (giây).
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  /**
   * Lấy TTL còn lại của key (giây). Trả về -1 nếu không có TTL, -2 nếu key không tồn tại.
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Ping Redis — dùng cho health check.
   */
  async ping(): Promise<string> {
    return this.client.ping();
  }

  /**
   * Thêm 1 phần tử vào Redis SET. Trả về số phần tử mới được thêm (0 nếu đã tồn tại).
   */
  async sadd(key: string, member: string): Promise<number> {
    try {
      return await this.client.sadd(key, member);
    } catch (error) {
      this.logger.error(
        `Redis SADD failed for key=${key}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Kiểm tra 1 phần tử có nằm trong Redis SET không.
   */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.client.sismember(key, member);
      return result === 1;
    } catch (error) {
      this.logger.error(
        `Redis SISMEMBER failed for key=${key}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Lấy toàn bộ phần tử của Redis SET.
   */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.smembers(key);
    } catch (error) {
      this.logger.error(
        `Redis SMEMBERS failed for key=${key}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Xóa 1 phần tử khỏi Redis SET. Trả về số phần tử đã bị xóa (0 nếu không tồn tại).
   */
  async srem(key: string, member: string): Promise<number> {
    try {
      return await this.client.srem(key, member);
    } catch (error) {
      this.logger.error(
        `Redis SREM failed for key=${key}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Expose raw ioredis client nếu cần thao tác nâng cao.
   * Dùng cẩn thận — không dùng cho business logic thông thường.
   */
  getClient(): Redis {
    return this.client;
  }
}

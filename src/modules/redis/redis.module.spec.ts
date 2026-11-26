import type Redis from 'ioredis';
import { RedisModule } from './redis.module.js';

/**
 * Client ioredis dùng chung phải được đóng khi app tắt — nếu không, app.close() xong tiến trình
 * vẫn treo vì socket Redis còn mở (graceful shutdown không kết thúc, e2e Jest không thoát).
 */
describe('RedisModule shutdown', () => {
  const client = (status: string) =>
    ({ status, quit: jest.fn().mockResolvedValue('OK'), disconnect: jest.fn() }) as unknown as Redis & {
      quit: jest.Mock;
      disconnect: jest.Mock;
    };

  it('quit() client khi ứng dụng tắt', async () => {
    const redis = client('ready');
    await new RedisModule(redis).onApplicationShutdown();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it('client đã đóng thì không gọi quit lần nữa', async () => {
    const redis = client('end');
    await new RedisModule(redis).onApplicationShutdown();
    expect(redis.quit).not.toHaveBeenCalled();
  });

  it('quit lỗi (mất kết nối) → disconnect cứng, không ném lỗi làm hỏng shutdown', async () => {
    const redis = client('ready');
    redis.quit.mockRejectedValue(new Error('Connection is closed.'));
    await expect(new RedisModule(redis).onApplicationShutdown()).resolves.toBeUndefined();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });
});

import { HealthController } from './health.controller.js';

/** Client BullMQ-Redis riêng của health check phải được đóng khi module hủy (tránh treo shutdown). */
describe('HealthController shutdown', () => {
  const make = (queueCheck: boolean) =>
    new HealthController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: (key: string, d?: unknown) => (key === 'HEALTH_CHECK_QUEUE' ? queueCheck : d) } as never,
      {} as never,
    );
  const swapClient = (c: HealthController, status: string) => {
    const client = { status, quit: jest.fn().mockResolvedValue('OK'), disconnect: jest.fn() };
    (c as unknown as { bullRedisClient: unknown }).bullRedisClient = client;
    return client;
  };

  it('đã kết nối → quit()', async () => {
    const c = make(true);
    const client = swapClient(c, 'ready');
    await c.onModuleDestroy();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('lazy, chưa từng kết nối → disconnect() (quit sẽ cố mở kết nối)', async () => {
    const c = make(true);
    const client = swapClient(c, 'wait');
    await c.onModuleDestroy();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('tắt health check queue → không có client, không lỗi', async () => {
    await expect(make(false).onModuleDestroy()).resolves.toBeUndefined();
  });
});

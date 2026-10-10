import { CompositeVisitorDeviceSync } from './composite-visitor-device-sync.js';

describe('CompositeVisitorDeviceSync', () => {
  it('chạy hồ sơ IVSS trước rồi FaceGate, cùng một id lượt', async () => {
    const order: string[] = [];
    const sync = new CompositeVisitorDeviceSync(
      { syncVisit: async (id: string) => { order.push(`ivss:${id}`); } } as never,
      { syncVisit: async (id: string) => { order.push(`facegate:${id}`); } } as never,
    );
    await sync.syncVisit('v1');
    expect(order).toEqual(['ivss:v1', 'facegate:v1']);
  });
});

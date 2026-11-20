import { RoomUtilizationReportProvider } from './room-utilization.provider.js';

const run = async (scope: { unrestricted: boolean; departmentIds: string[] | null }, filters: Record<string, unknown> = {}) => {
  const query = jest.fn().mockResolvedValue([]);
  const provider = new RoomUtilizationReportProvider({ query } as never);
  await provider.build({ from: '2026-11-01', to: '2026-11-20', ...filters } as never, scope, null, new Date('2026-11-20T05:00:00Z'));
  const [sql, params] = query.mock.calls[0] as [string, unknown[]];
  return { sql, params };
};

describe('RoomUtilizationReportProvider — phạm vi dữ liệu', () => {
  it('quản trị / BGH (unrestricted): không lọc theo người đặt', async () => {
    const { sql, params } = await run({ unrestricted: true, departmentIds: null });
    expect(sql).not.toMatch(/booked_by/);
    expect(params).toEqual(['2026-11-01', '2026-11-20']);
  });

  it('MANAGER: chỉ tính lượt đặt do cán bộ thuộc đơn vị mình quản lý tạo', async () => {
    const { sql, params } = await run({ unrestricted: false, departmentIds: ['d1', 'd2'] });
    expect(sql).toMatch(/bu\.id = rb\.booked_by AND bu\.department_id = ANY\(\$3::uuid\[\]\)/);
    expect(params).toEqual(['2026-11-01', '2026-11-20', ['d1', 'd2']]);
  });

  it('MANAGER + bộ lọc phòng: tham số phạm vi đứng sau tham số bộ lọc', async () => {
    const { sql, params } = await run({ unrestricted: false, departmentIds: ['d1'] }, { roomId: 'r1' });
    expect(sql).toMatch(/r\.id = ANY\(\$3::uuid\[\]\)/);
    expect(sql).toMatch(/bu\.department_id = ANY\(\$4::uuid\[\]\)/);
    expect(params[3]).toEqual(['d1']);
  });

  it('MANAGER không quản lý đơn vị nào: danh sách rỗng → không lộ dữ liệu', async () => {
    const { params } = await run({ unrestricted: false, departmentIds: null });
    expect(params[2]).toEqual([]);
  });
});

import { ReportScheduleRunService } from './report-schedule-run.service.js';

describe('ReportScheduleRunService — lịch sử đã kết thúc', () => {
  const make = () => {
    const query = jest.fn().mockResolvedValueOnce([{ n: '12' }]).mockResolvedValueOnce([]);
    const service = new ReportScheduleRunService(
      { query } as never, {} as never, {} as never, {} as never, {} as never,
    );
    return { service, query };
  };

  it('lọc trạng thái kết thúc trước khi đếm tổng và lấy trang', async () => {
    const { service, query } = make();
    const result = await service.list({ page: 2, limit: 10 });
    expect(result).toEqual({ items: [], total: 12, page: 2, limit: 10 });
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain("WHERE status IN ('success', 'failed')");
    }
    expect(query.mock.calls[1][1]).toEqual([10, 10]);
  });

  it('giữ bộ lọc lịch gửi, trạng thái và ngày trong cả truy vấn tổng và danh sách', async () => {
    const { service, query } = make();
    await service.list({ scheduleId: 'schedule-1', status: 'failed', from: '2026-11-01', to: '2026-11-27' });
    expect(query.mock.calls[0][1]).toEqual([['schedule-1'], ['failed'], '2026-11-01', '2026-11-27']);
    expect(query.mock.calls[1][1]).toEqual([['schedule-1'], ['failed'], '2026-11-01', '2026-11-27', 10, 0]);
    expect(query.mock.calls[1][0]).toContain(query.mock.calls[0][0].split('FROM report_schedule_runs')[1]);
  });

  it.each(['queued', 'running'])('không cho gửi lại lượt %s', async (status) => {
    const dispatcher = { enqueue: jest.fn() };
    const txQuery = jest.fn().mockResolvedValue([{ status }]);
    const service = new ReportScheduleRunService(
      { transaction: (fn: (m: unknown) => unknown) => fn({ query: txQuery }) } as never,
      {} as never, dispatcher as never, {} as never, {} as never,
    );
    await expect(service.retry('11111111-1111-4111-8111-111111111111')).rejects.toThrow('Chỉ gửi lại được lần chạy thất bại');
    expect(txQuery).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });
});

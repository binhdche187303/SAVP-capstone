import { DashboardOverviewRepository } from '../repositories/dashboard-overview.repository';

describe('DashboardOverviewRepository', () => {
  let repo: DashboardOverviewRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new DashboardOverviewRepository({
      query: mockQuery,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildScopeWhere (implicit via aggregate methods)', () => {
    it('null scopeDepartmentIds -> no department filter', async () => {
      mockQuery.mockResolvedValue([{ cnt: 5 }]);
      const result = await repo.countMeetings(baseParams);
      expect(result).toBe(5);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('department_id');
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([{ cnt: 0 }]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      const result = await repo.countMeetings(params);
      expect(result).toBe(0);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('non-empty scopeDepartmentIds -> ANY clause with uuid[]', async () => {
      mockQuery.mockResolvedValue([{ cnt: 3 }]);
      const params = {
        ...baseParams,
        scopeDepartmentIds: ['d1', 'd2'],
      };
      const result = await repo.countMeetings(params);
      expect(result).toBe(3);
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContainEqual(['d1', 'd2']);
    });

    it('roomId filter -> AND room_id clause', async () => {
      mockQuery.mockResolvedValue([{ cnt: 2 }]);
      const params = { ...baseParams, roomId: 'room-1' };
      const result = await repo.countMeetings(params);
      expect(result).toBe(2);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('room_id');
    });

    it('departmentId filter -> subquery clause', async () => {
      mockQuery.mockResolvedValue([{ cnt: 1 }]);
      const params = { ...baseParams, departmentId: 'dept-1' };
      const result = await repo.countMeetings(params);
      expect(result).toBe(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('department_id');
    });
  });

  describe('countActiveRooms', () => {
    it('giữ phạm vi phòng ban và phòng khi đếm phòng đang họp', async () => {
      mockQuery.mockResolvedValue([{ cnt: 1 }]);
      const result = await repo.countActiveRooms({
        ...baseParams,
        scopeDepartmentIds: ['dept-1'],
        roomId: 'room-1',
      });
      expect(result).toBe(1);
      expect(mockQuery.mock.calls[0][1]).toEqual([['dept-1'], 'room-1']);
    });
  });

  describe('getUtilizationAggregate', () => {
    it('returns actual and reserved minutes', async () => {
      mockQuery.mockResolvedValue([
        { actual_minutes_sum: '600', reserved_minutes_sum: '1000' },
      ]);
      const result = await repo.getUtilizationAggregate(baseParams);
      expect(result).toEqual({
        actualMinutesSum: 600,
        reservedMinutesSum: 1000,
      });
    });

    it('NULL values -> 0', async () => {
      mockQuery.mockResolvedValue([
        { actual_minutes_sum: null, reserved_minutes_sum: null },
      ]);
      const result = await repo.getUtilizationAggregate(baseParams);
      expect(result).toEqual({ actualMinutesSum: 0, reservedMinutesSum: 0 });
    });
  });

  describe('getNoShowAggregate', () => {
    it('returns counts', async () => {
      mockQuery.mockResolvedValue([{ no_show_count: 3, booking_count: 20 }]);
      const result = await repo.getNoShowAggregate(baseParams);
      expect(result).toEqual({ noShowCount: 3, bookingCount: 20 });
    });
  });

  describe('getAttendanceAggregate', () => {
    it('returns counts', async () => {
      mockQuery.mockResolvedValue([{ total_count: 50, on_time_count: 42 }]);
      const result = await repo.getAttendanceAggregate(baseParams);
      expect(result).toEqual({ onTimeCount: 42, totalCount: 50 });
    });
  });

  describe('countActiveUsers', () => {
    it('returns count', async () => {
      mockQuery.mockResolvedValue([{ cnt: 25 }]);
      const result = await repo.countActiveUsers(baseParams);
      expect(result).toBe(25);
    });

    it('NULL -> 0', async () => {
      mockQuery.mockResolvedValue([{ cnt: null }]);
      const result = await repo.countActiveUsers(baseParams);
      expect(result).toBe(0);
    });
  });

  describe('getDailyTrend', () => {
    it('returns mapped rows', async () => {
      mockQuery.mockResolvedValue([
        {
          date: '2026-06-01',
          meeting_count: 5,
          actual_minutes_sum: '300',
          reserved_minutes_sum: '500',
        },
        {
          date: '2026-06-02',
          meeting_count: 0,
          actual_minutes_sum: '0',
          reserved_minutes_sum: '0',
        },
      ]);
      const result = await repo.getDailyTrend(baseParams);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: '2026-06-01',
        meetingCount: 5,
        actualMinutesSum: 300,
        reservedMinutesSum: 500,
      });
      expect(result[1].meetingCount).toBe(0);
    });

    it('empty result -> empty array', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await repo.getDailyTrend(baseParams);
      expect(result).toEqual([]);
    });
  });
});

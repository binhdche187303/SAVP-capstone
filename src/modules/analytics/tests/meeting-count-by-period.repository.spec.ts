import { MeetingCountByPeriodRepository } from '../repositories/meeting-count-by-period.repository';

describe('MeetingCountByPeriodRepository', () => {
  let repo: MeetingCountByPeriodRepository;
  let mockQuery: jest.Mock;

  const baseParams = {
    from: '2026-06-01',
    to: '2026-06-30',
    scopeDepartmentIds: null as string[] | null,
    granularity: 'week',
  };

  beforeEach(() => {
    mockQuery = jest.fn();
    repo = new MeetingCountByPeriodRepository({
      query: mockQuery,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getManagerDepartmentIds', () => {
    it('queries departments for manager', async () => {
      mockQuery.mockResolvedValue([{ id: 'd1' }]);
      const result = await repo.getManagerDepartmentIds('user-1');
      expect(result).toEqual(['d1']);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM departments'),
        ['user-1'],
      );
    });
  });

  describe('buildScopeWhere (via methods)', () => {
    it('null scopeDepartmentIds -> no organizer_id scope filter', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.countMeetingsByBucket(baseParams);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain(
        'organizer_id IN (SELECT u.id FROM users u WHERE u.department_id = ANY(',
      );
    });

    it('empty scopeDepartmentIds -> FALSE clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, scopeDepartmentIds: [] as string[] };
      await repo.countMeetingsByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('FALSE');
    });

    it('non-empty scopeDepartmentIds -> ANY clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        scopeDepartmentIds: ['d1', 'd2'],
      };
      await repo.countMeetingsByBucket(params);
      const values = mockQuery.mock.calls[0][1];
      expect(values).toContainEqual(['d1', 'd2']);
    });

    it('departmentId filter -> organizer_id subquery with uuid[] param', async () => {
      mockQuery.mockResolvedValue([]);
      const params = {
        ...baseParams,
        departmentId: 'd3',
      };
      await repo.countMeetingsByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain(
        'organizer_id IN (SELECT u2.id FROM users u2 WHERE u2.department_id = ANY($',
      );
    });

    it('roomId filter -> room_id clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, roomId: 'room-1' };
      await repo.countMeetingsByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('room_id = ');
    });

    it('meetingType filter -> meeting_type clause', async () => {
      mockQuery.mockResolvedValue([]);
      const params = { ...baseParams, meetingType: 'normal' };
      await repo.countMeetingsByBucket(params);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('meeting_type = ');
    });
  });

  describe('countMeetingsByBucket', () => {
    it('returns counts map grouped by period', async () => {
      mockQuery.mockResolvedValue([{ period: '2026-W23', cnt: 12 }]);
      const result = await repo.countMeetingsByBucket(baseParams);
      expect(result.get('2026-W23')).toBe(12);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status IN ('completed', 'scheduled')");
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('GROUP BY period');
    });

    it('uses correct format patterns', async () => {
      mockQuery.mockResolvedValue([]);

      await repo.countMeetingsByBucket({ ...baseParams, granularity: 'week' });
      expect(mockQuery.mock.calls[0][0]).toContain('IYYY-"W"IW');

      await repo.countMeetingsByBucket({ ...baseParams, granularity: 'month' });
      expect(mockQuery.mock.calls[1][0]).toContain('YYYY-MM');
    });
  });
});

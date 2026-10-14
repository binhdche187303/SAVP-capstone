import { ForbiddenException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { MeetingListService } from './meeting-list.service.js';
import { MeetingListQueryDto } from '../dto/meeting-list-query.dto.js';
import { MeetingStatus } from '../entities/meeting.entity.js';

/**
 * MeetingListService (BE-02, GET /meetings): filter AND, allowlist sortBy,
 * phan trang, chan from > to. File test rieng, mock DataSource.getRepository().createQueryBuilder().
 */
describe('MeetingListService.list', () => {
  function makeMeetingEntity(overrides: Record<string, unknown> = {}) {
    return {
      id: 'meeting-1',
      meetingCode: 'MT-20260726-001',
      title: 'Sprint Review',
      status: MeetingStatus.SCHEDULED,
      meetingType: 'normal',
      meetingMode: 'offline',
      startTime: new Date('2026-07-27T10:00:00Z'),
      endTime: new Date('2026-07-27T11:00:00Z'),
      roomId: 'room-1',
      organizerId: 'user-1',
      createdAt: new Date('2026-07-20T00:00:00Z'),
      ...overrides,
    };
  }

  function setup(
    entities: unknown[] = [makeMeetingEntity()],
    raw: Record<string, unknown>[] = [
      { organizer_full_name: 'Nguyen Van A', room_room_name: 'Phong A' },
    ],
    total = 1,
    access: { roles: string[]; permissions: string[] } = {
      roles: ['SYSTEM_ADMIN'],
      permissions: ['meeting.read.all'],
    },
    managerDeptIds: string[] = [],
  ) {
    const qb: Record<string, jest.Mock> = {};
    for (const m of [
      'leftJoin',
      'where',
      'andWhere',
      'orderBy',
      'skip',
      'take',
      'select',
      'addSelect',
    ]) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getRawAndEntities = jest.fn().mockResolvedValue({ entities, raw });
    qb.getCount = jest.fn().mockResolvedValue(total);

    const repo = { createQueryBuilder: jest.fn(() => qb) };
    const dataSource = {
      getRepository: jest.fn(() => repo),
      query: jest.fn().mockResolvedValue(managerDeptIds.map((id) => ({ id }))),
    } as unknown as import('typeorm').DataSource;
    const authzRepo = {
      getEffectiveRolesAndPermissions: jest.fn().mockResolvedValue(access),
    } as unknown as import('../../auth/repositories/authz-read.repository.js').AuthzReadRepository;

    const svc = new MeetingListService(dataSource, authzRepo);
    // Mặc định gọi bằng admin (có meeting.read.all) để các test lọc/sort cũ giữ nguyên.
    const service = {
      list: (query: MeetingListQueryDto, userId = 'admin-1') =>
        svc.list(query, userId),
    };
    return { service, qb };
  }

  function q(
    overrides: Partial<MeetingListQueryDto> = {},
  ): MeetingListQueryDto {
    return {
      page: 1,
      limit: 20,
      sortBy: 'created_at',
      sortOrder: 'desc',
      ...overrides,
    };
  }

  function andWhereStrings(qb: Record<string, jest.Mock>): string[] {
    return qb.andWhere.mock.calls.map((c: unknown[]) => c[0] as string);
  }

  it('khong filter → chi where deleted_at IS NULL, map DTO tu entity + raw', async () => {
    const { service, qb } = setup();
    const res = await service.list(q());

    expect(qb.where).toHaveBeenCalledWith('meeting.deleted_at IS NULL');
    expect(res.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(res.data[0]).toMatchObject({
      id: 'meeting-1',
      title: 'Sprint Review',
      roomName: 'Phong A',
      organizerName: 'Nguyen Van A',
    });
  });

  it('status filter → andWhere meeting.status', async () => {
    const { service, qb } = setup();
    await service.list(q({ status: MeetingStatus.CANCELLED }));
    expect(andWhereStrings(qb)).toContain('meeting.status = :status');
  });

  it('roomId filter → andWhere meeting.room_id', async () => {
    const { service, qb } = setup();
    await service.list(q({ roomId: '11111111-1111-1111-1111-111111111111' }));
    expect(andWhereStrings(qb)).toContain('meeting.room_id = :roomId');
  });

  it('organizerId filter → andWhere meeting.organizer_id', async () => {
    const { service, qb } = setup();
    await service.list(
      q({ organizerId: '22222222-2222-2222-2222-222222222222' }),
    );
    expect(andWhereStrings(qb)).toContain(
      'meeting.organizer_id = :organizerId',
    );
  });

  it('search filter → andWhere ILIKE title', async () => {
    const { service, qb } = setup();
    await service.list(q({ search: 'sprint' }));
    expect(andWhereStrings(qb)).toContain('meeting.title ILIKE :search');
  });

  it('from/to filter → andWhere start_time >= from AND <= to', async () => {
    const { service, qb } = setup();
    await service.list(
      q({ from: '2026-07-01T00:00:00Z', to: '2026-07-31T23:59:59Z' }),
    );
    const strs = andWhereStrings(qb);
    expect(strs).toContain('meeting.start_time >= :from');
    expect(strs).toContain('meeting.start_time <= :to');
  });

  it('from > to → throw 400 BadRequestException, khong query DB', async () => {
    const { service, qb } = setup();
    await expect(
      service.list(
        q({ from: '2026-07-31T00:00:00Z', to: '2026-07-01T00:00:00Z' }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(qb.getRawAndEntities).not.toHaveBeenCalled();
  });

  it('sortBy allowlist — map dung cot SQL cho ca 4 gia tri hop le', async () => {
    const cases: Array<[string, string]> = [
      ['created_at', 'meeting.created_at'],
      ['start_time', 'meeting.start_time'],
      ['title', 'meeting.title'],
      ['status', 'meeting.status'],
    ];
    for (const [sortBy, column] of cases) {
      const { service, qb } = setup();
      await service.list(q({ sortBy: sortBy as never, sortOrder: 'asc' }));
      expect(qb.orderBy).toHaveBeenCalledWith(column, 'ASC');
    }
  });

  it('phan trang — skip/take dung cong thuc (page-1)*limit', async () => {
    const { service, qb } = setup([], [], 45);
    const res = await service.list(q({ page: 3, limit: 10 }));
    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(res.meta.total).toBe(45);
    expect(res.meta.totalPages).toBe(5);
  });

  it('ket hop nhieu filter → nhieu andWhere (AND)', async () => {
    const { service, qb } = setup();
    await service.list(
      q({
        status: MeetingStatus.SCHEDULED,
        roomId: '11111111-1111-1111-1111-111111111111',
        search: 'demo',
      }),
    );
    const strs = andWhereStrings(qb);
    expect(strs).toContain('meeting.status = :status');
    expect(strs).toContain('meeting.room_id = :roomId');
    expect(strs).toContain('meeting.title ILIKE :search');
  });

  it('roomName/organizerName null khi raw khong co du lieu (LEFT JOIN khong khop)', async () => {
    const { service } = setup(
      [makeMeetingEntity()],
      [{ organizer_full_name: null, room_room_name: null }],
    );
    const res = await service.list(q());
    expect(res.data[0].roomName).toBeNull();
    expect(res.data[0].organizerName).toBeNull();
  });

  it('BE-5: has_transcript raw = 1 → hasTranscript true', async () => {
    const { service } = setup(
      [makeMeetingEntity()],
      [
        {
          organizer_full_name: 'Nguyen Van A',
          room_room_name: 'Phong A',
          has_transcript: 1,
        },
      ],
    );
    const res = await service.list(q());
    expect(res.data[0].hasTranscript).toBe(true);
  });

  it('BE-5: has_transcript raw = null/undefined → hasTranscript false', async () => {
    const { service } = setup(
      [makeMeetingEntity()],
      [
        {
          organizer_full_name: 'Nguyen Van A',
          room_room_name: 'Phong A',
          has_transcript: null,
        },
      ],
    );
    const res = await service.list(q());
    expect(res.data[0].hasTranscript).toBe(false);
  });

  it('MANAGER: chỉ thấy cuộc họp phòng ban mình quản lý', async () => {
    const { service, qb } = setup(
      undefined,
      undefined,
      undefined,
      {
        roles: ['MANAGER'],
        permissions: [],
      },
      ['dept-1'],
    );
    await service.list(q(), 'mgr-1');
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('organizer.department_id IN (:...deptIds)'),
      { deptIds: ['dept-1'] },
    );
  });

  it('MANAGER không quản lý phòng ban nào → danh sách rỗng, không query', async () => {
    const { service, qb } = setup(undefined, undefined, undefined, {
      roles: ['MANAGER'],
      permissions: [],
    });
    const res = await service.list(q(), 'mgr-1');
    expect(res.meta.total).toBe(0);
    expect(qb.getRawAndEntities).not.toHaveBeenCalled();
  });

  it('không có meeting.read.all và không phải MANAGER → 403', async () => {
    const { service } = setup(undefined, undefined, undefined, {
      roles: ['EMPLOYEE'],
      permissions: [],
    });
    await expect(service.list(q(), 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

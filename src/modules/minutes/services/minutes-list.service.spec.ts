/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { DataSource, Brackets } from 'typeorm';
import { InternalServerErrorException } from '@nestjs/common';

import { MinutesService } from '../services/minutes.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { MeetingMode } from '../../meetings/entities/meeting.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';

describe('MinutesService.findMinutesList', () => {
  let service: MinutesService;
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let auditLogsService: { logAction: jest.Mock };
  let authzRepo: { getEffectiveRolesAndPermissions: jest.Mock };
  let qb: {
    leftJoin: jest.Mock;
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };
  let minutesRepo: { createQueryBuilder: jest.Mock };
  let roomRepo: { find: jest.Mock };
  let userRepo: { find: jest.Mock };

  const authUser = { userId: 'user-1' };

  const buildMinutesRow = (overrides: Partial<any> = {}): any => ({
    id: 'minutes-1',
    title: 'Bien ban hop A',
    status: MeetingMinutesStatus.PUBLISHED,
    versionNo: 1,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    preparedBy: 'host-1',
    meeting: {
      id: 'meeting-1',
      title: 'Sprint Planning',
      actualStartTime: new Date('2026-06-30T09:00:00Z'),
      actualEndTime: new Date('2026-06-30T10:00:00Z'),
      meetingMode: MeetingMode.OFFLINE,
      hostId: 'host-1',
      roomId: 'room-1',
      host: { id: 'host-1', fullName: 'Nguyen Van A', email: 'a@company.com' },
    },
    ...overrides,
  });

  beforeEach(() => {
    qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    roomRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === RoomEntity) return roomRepo;
        if (entity === UserEntity) return userRepo;
        throw new Error('Unexpected entity requested: ' + String(entity));
      }),
    };

    auditLogsService = { logAction: jest.fn() };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['INTERNAL_USER'], permissions: [] }),
    };

    service = new MinutesService(
      dataSource as unknown as DataSource,
      auditLogsService as unknown as AuditLogsService,
      authzRepo as unknown as AuthzReadRepository,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('luôn loại trừ status=deleted', async () => {
    await service.findMinutesList({}, authUser);
    expect(qb.where).toHaveBeenCalledWith('minutes.deletedAt IS NULL');
  });

  it('áp dụng scope Brackets khi không phải admin', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['INTERNAL_USER'],
      permissions: [],
    });

    await service.findMinutesList({}, authUser);

    const bracketsCall = qb.andWhere.mock.calls.find(
      (call: unknown[]) => call[0] instanceof Brackets,
    );
    expect(bracketsCall).toBeDefined();
  });

  it.each(['BUSINESS_ADMIN', 'SYSTEM_ADMIN'])(
    'bỏ qua scope Brackets khi role là %s (xem toàn bộ)',
    async (role) => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: [role],
        permissions: [],
      });

      await service.findMinutesList({}, authUser);

      const bracketsCall = qb.andWhere.mock.calls.find(
        (call: unknown[]) => call[0] instanceof Brackets,
      );
      expect(bracketsCall).toBeUndefined();
    },
  );

  it('áp dụng filter status của client (AND thêm vào scope)', async () => {
    await service.findMinutesList({ status: 'archived' }, authUser);
    expect(qb.andWhere).toHaveBeenCalledWith('minutes.status IN (:...clientStatus)', {
      clientStatus: ['archived'],
    });
  });

  it('không filter status khi client truyền "all"', async () => {
    await service.findMinutesList({ status: 'all' }, authUser);
    const statusCall = qb.andWhere.mock.calls.find(
      (call: unknown[]) => call[0] === 'minutes.status IN (:...clientStatus)',
    );
    expect(statusCall).toBeUndefined();
  });

  it('áp dụng filter roomId', async () => {
    await service.findMinutesList({ roomId: 'room-99' }, authUser);
    expect(qb.andWhere).toHaveBeenCalledWith('meeting.roomId = :roomId', {
      roomId: 'room-99',
    });
  });

  it('áp dụng filter date range from/to', async () => {
    await service.findMinutesList(
      {
        from: '2026-06-01T00:00:00Z',
        to: '2026-06-30T23:59:59Z',
      },
      authUser,
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'COALESCE(meeting.actualStartTime, meeting.startTime) >= :from',
      { from: new Date('2026-06-01T00:00:00Z') },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'COALESCE(meeting.actualStartTime, meeting.startTime) <= :to',
      { to: new Date('2026-06-30T23:59:59Z') },
    );
  });

  it('áp dụng search q trên minutes.title/meeting.title/host.fullName', async () => {
    await service.findMinutesList({ q: 'Sprint' }, authUser);
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(minutes.title ILIKE :q OR meeting.title ILIKE :q OR host.fullName ILIKE :q)',
      { q: '%Sprint%' },
    );
  });

  it('sort mặc định theo meeting.actualStartTime DESC', async () => {
    await service.findMinutesList({}, authUser);
    expect(qb.orderBy).toHaveBeenCalledWith('meeting.actualStartTime', 'DESC');
  });

  it('sort theo created_at khi client truyền sortBy=created_at, sortOrder=asc', async () => {
    await service.findMinutesList(
      { sortBy: 'created_at', sortOrder: 'asc' },
      authUser,
    );
    expect(qb.orderBy).toHaveBeenCalledWith('minutes.createdAt', 'ASC');
  });

  it('giới hạn limit tối đa 20 (BR2) kể cả khi client truyền cao hơn', async () => {
    await service.findMinutesList({ limit: 999, page: 2 }, authUser);
    expect(qb.skip).toHaveBeenCalledWith(20); // page 2, limit clamped to 20 => skip 20
    expect(qb.take).toHaveBeenCalledWith(20);
  });

  it('trả về room=null khi meeting.roomId=null (meeting online)', async () => {
    qb.getManyAndCount.mockResolvedValue([
      [
        buildMinutesRow({
          meeting: {
            id: 'meeting-2',
            title: 'Weekly Sync',
            actualStartTime: new Date('2026-07-01T07:30:00Z'),
            actualEndTime: null,
            meetingMode: MeetingMode.ONLINE,
            hostId: 'host-1',
            roomId: null,
            host: { id: 'host-1', fullName: 'A', email: 'a@company.com' },
          },
        }),
      ],
      1,
    ]);

    const result = await service.findMinutesList({}, authUser);

    expect(roomRepo.find).not.toHaveBeenCalled();
    expect(result.items[0].meeting.room).toBeNull();
  });

  it('trả về room hợp lệ khi meeting.roomId có giá trị (batch load)', async () => {
    roomRepo.find.mockResolvedValue([
      { id: 'room-1', roomName: 'Phong 101' } as RoomEntity,
    ]);
    qb.getManyAndCount.mockResolvedValue([[buildMinutesRow()], 1]);

    const result = await service.findMinutesList({}, authUser);

    expect(roomRepo.find).toHaveBeenCalled();
    expect(result.items[0].meeting.room).toEqual({
      id: 'room-1',
      roomName: 'Phong 101',
    });
  });

  it('trả về host=null khi meeting.hostId=null', async () => {
    qb.getManyAndCount.mockResolvedValue([
      [
        buildMinutesRow({
          meeting: {
            id: 'meeting-3',
            title: 'No Host Meeting',
            actualStartTime: new Date('2026-07-01T07:30:00Z'),
            actualEndTime: null,
            meetingMode: MeetingMode.OFFLINE,
            hostId: null,
            roomId: null,
            host: null,
          },
        }),
      ],
      1,
    ]);

    const result = await service.findMinutesList({}, authUser);
    expect(result.items[0].host).toBeNull();
  });

  it('gắn cờ isAiGenerated: true khi ai_summary_json khác NULL, false khi NULL (MKM-AI-02)', async () => {
    qb.getManyAndCount.mockResolvedValue([
      [
        buildMinutesRow({
          id: 'ai-1',
          aiSummaryJson: { keyPoints: ['x'], meta: { provider: 'mock' } },
        }),
        buildMinutesRow({ id: 'manual-1', aiSummaryJson: null }),
      ],
      2,
    ]);
    const result = await service.findMinutesList({}, authUser);
    expect(result.items[0].isAiGenerated).toBe(true);
    expect(result.items[1].isAiGenerated).toBe(false);
  });

  it('trả 200 rỗng khi không có biên bản nào trong scope', async () => {
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const result = await service.findMinutesList({}, authUser);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('ném InternalServerErrorException khi query thất bại', async () => {
    qb.getManyAndCount.mockRejectedValue(new Error('DB down'));
    await expect(service.findMinutesList({}, authUser)).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});

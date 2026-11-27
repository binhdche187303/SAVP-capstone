/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { ManagerSummaryService } from './manager-summary.service.js';

describe('ManagerSummaryService (CDB-RS-001)', () => {
  let service: ManagerSummaryService;
  let userRepo: any;
  let dataSourceMock: any;

  const build = () => {
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManagerSummaryService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(ManagerSummaryService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  it('teamPresenceToday: team rỗng → presentCount=0, totalCount=0, KHÔNG gọi query gate log', async () => {
    userRepo.find.mockResolvedValue([]);
    const result = await service.getSummary('manager-1');
    expect(result.teamPresenceToday).toEqual({
      presentCount: 0,
      totalCount: 0,
    });
  });

  it('teamPresenceToday: đếm người có lượt cổng cuối cùng là vào, trong phạm vi nhân viên trực tiếp', async () => {
    userRepo.find.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
    dataSourceMock.query.mockImplementation((sql: string) => {
      if (sql.includes('gate_access_logs')) {
        return Promise.resolve([{ user_id: 'u1' }, { user_id: 'u2' }]);
      }
      return Promise.resolve([]);
    });
    const result = await service.getSummary('manager-1');
    expect(result.teamPresenceToday).toEqual({
      presentCount: 2,
      totalCount: 3,
    });
    const [, params] = dataSourceMock.query.mock.calls.find(
      ([sql]: [string]) => sql.includes('gate_access_logs'),
    );
    expect(params[0]).toEqual(['u1', 'u2', 'u3']);
    expect(params[1]).toBeInstanceOf(Date);
    expect(params[2]).toBeInstanceOf(Date);
    expect(params[1].getTime()).toBeLessThanOrEqual(params[2].getTime());
  });

  it('pendingMeetingRequestsCount: đọc đúng từ query 2-nhánh điều kiện', async () => {
    userRepo.find.mockResolvedValue([]);
    dataSourceMock.query.mockImplementation((sql: string) => {
      if (sql.includes('meeting_requests')) {
        return Promise.resolve([{ count: '4' }]);
      }
      return Promise.resolve([]);
    });
    const result = await service.getSummary('manager-1');
    expect(result.pendingMeetingRequestsCount).toBe(4);
  });

  it('onTimeRateThisWeek: sampleSize=0 → rate=0, KHÔNG NaN/chia 0', async () => {
    userRepo.find.mockResolvedValue([]);
    dataSourceMock.query.mockImplementation((sql: string) => {
      if (sql.includes('classified')) {
        return Promise.resolve([{ on_time_count: '0', total_count: '0' }]);
      }
      return Promise.resolve([]);
    });
    const result = await service.getSummary('manager-1');
    expect(result.onTimeRateThisWeek).toEqual({ rate: 0, sampleSize: 0 });
    expect(Number.isNaN(result.onTimeRateThisWeek.rate)).toBe(false);
  });

  it('onTimeRateThisWeek: tính đúng công thức làm tròn 1 chữ số thập phân', async () => {
    userRepo.find.mockResolvedValue([]);
    dataSourceMock.query.mockImplementation((sql: string) => {
      if (sql.includes('classified')) {
        return Promise.resolve([{ on_time_count: '8', total_count: '10' }]);
      }
      return Promise.resolve([]);
    });
    const result = await service.getSummary('manager-1');
    expect(result.onTimeRateThisWeek).toEqual({ rate: 80, sampleSize: 10 });
  });

  it('teamZoneSecurityAlerts: luôn đúng shape {value:null, note:"not_available"}', async () => {
    userRepo.find.mockResolvedValue([]);
    const result = await service.getSummary('manager-1');
    expect(result.teamZoneSecurityAlerts).toEqual({
      value: null,
      note: 'not_available',
    });
  });
});

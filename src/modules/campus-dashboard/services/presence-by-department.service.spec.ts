/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PresenceByDepartmentService } from './presence-by-department.service.js';

describe('PresenceByDepartmentService (2.12)', () => {
  let service: PresenceByDepartmentService;
  let dataSourceMock: any;

  beforeEach(async () => {
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceByDepartmentService,
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(PresenceByDepartmentService);
  });

  const row = (
    id: string | null,
    name: string | null,
    present: number,
    total: number,
  ) => ({
    department_id: id,
    department_code: id ? id.toUpperCase() : null,
    department_name: name,
    present_count: present,
    total_staff: total,
  });

  it('SQL: lấy log cuối hôm nay theo user, chỉ enter/leave, mốc = đầu ngày', async () => {
    await service.getPresence();
    const [sql, params] = dataSourceMock.query.mock.calls[0];
    expect(sql).toContain('DISTINCT ON (user_id)');
    expect(sql).toContain("direction IN ('enter', 'leave')");
    expect(sql).toContain("l.direction = 'enter'");
    const start: Date = params[0];
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('map + sắp xếp: nhiều người có mặt trước, nhóm chưa gán phòng ban cuối khi bằng số', async () => {
    dataSourceMock.query.mockResolvedValue([
      row('hr', 'Phong Nhan su', 1, 4),
      row(null, null, 1, 2),
      row('it', 'Phong Cong nghe thong tin', 3, 4),
      row('adm', 'Phong Hanh chinh', 1, 1),
    ]);

    const result = await service.getPresence();

    expect(result.departments.map((d) => d.departmentId)).toEqual([
      'it',
      'adm',
      'hr',
      null,
    ]);
    expect(result.departments[0]).toEqual({
      departmentId: 'it',
      departmentCode: 'IT',
      departmentName: 'Phong Cong nghe thong tin',
      presentCount: 3,
      totalStaff: 4,
    });
    expect(result.totalPresent).toBe(6);
    expect(typeof result.generatedAt).toBe('string');
  });

  it('không có dữ liệu → departments rỗng, totalPresent=0', async () => {
    const result = await service.getPresence();
    expect(result.departments).toEqual([]);
    expect(result.totalPresent).toBe(0);
  });
});

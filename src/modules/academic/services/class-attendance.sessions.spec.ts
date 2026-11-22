import { BadRequestException } from '@nestjs/common';
import { ClassAttendanceService } from './class-attendance.service.js';

/** listSessions: validate khoảng ngày + phạm vi theo QUYỀN (class.attendance.read.all) + map kết quả. */
describe('ClassAttendanceService.listSessions', () => {
  const sessionRow = {
    id: 'se-1',
    session_date: '2026-11-11',
    start_clock: '07:00',
    end_clock: '11:00',
    start_time: '2026-11-11T00:00:00.000Z',
    end_time: '2026-11-11T04:00:00.000Z',
    status: 'scheduled',
    source: 'uel_api',
    period_start: 1,
    period_count: 4,
    class_id: 'sec-1',
    class_code: '261BMA202504',
    subject_code: 'BMA2025',
    subject_name: 'Môn A',
    semester_name: 'Học kỳ 1 năm học 2026-2027',
    teacher: null,
    room: null,
    student_count: '65',
  };

  function makeService(permissions: string[]) {
    const query = jest.fn(async () => [sessionRow]);
    const authzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(async () => ({ roles: [], permissions })),
    };
    const service = new ClassAttendanceService(
      { manager: { query } } as never,
      {} as never,
      authzRepo as never,
    );
    return { service, query };
  }

  it('từ chối ngày sai định dạng / khoảng ngược / quá 62 ngày', async () => {
    const { service, query } = makeService(['class.attendance.manage']);
    await expect(
      service.listSessions('u1', '11/11/2026', '2026-11-17'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listSessions('u1', '2026-11-17', '2026-11-11'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listSessions('u1', '2026-01-01', '2026-03-15'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listSessions('u1', undefined, '2026-11-17'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('không có read.all (GV): chỉ lớp mình dạy/học, tham số ngày sau userId', async () => {
    const { service, query } = makeService(['class.attendance.manage', 'class.attendance.export']);
    const data = await service.listSessions('u1', '2026-11-09', '2026-11-15');
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('cs.lecturer_user_id = $1');
    expect(sql).toContain('BETWEEN $2::date AND $3::date');
    expect(params).toEqual(['u1', '2026-11-09', '2026-11-15']);
    expect(data).toEqual([
      expect.objectContaining({
        id: 'se-1',
        date: '2026-11-11',
        startTime: '07:00',
        endTime: '11:00',
        classCode: '261BMA202504',
        subjectCode: 'BMA2025',
        teacher: '',
        room: '',
        studentCount: 65,
      }),
    ]);
  });

  it('có class.attendance.read.all: không lọc theo user, ngày là $1/$2', async () => {
    const { service, query } = makeService(['class.attendance.read.all']);
    await service.listSessions('u1', '2026-11-09', '2026-11-15');
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('BETWEEN $1::date AND $2::date');
    expect(params).toEqual(['2026-11-09', '2026-11-15']);
    expect(sql).not.toContain('lecturer_user_id = $1');
  });

  it('SV (chỉ read.self): lọc theo lớp đã đăng ký', async () => {
    const { service, query } = makeService(['class.attendance.read.self']);
    await service.listSessions('u1', '2026-11-09', '2026-11-15');
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain('st2.user_id = $1');
  });
});

import { DataSource } from 'typeorm';
import { ClassAttendanceService } from './class-attendance.service';
import { HgVisionService } from './hgvision.service';

// Bộ quyền điểm danh lớp của từng vai trò trong DB (sau migration ClassAttendancePermissionBased).
const ROLE_PERMS: Record<string, string[]> = {
  BUSINESS_ADMIN: ['class.attendance.stats.read', 'class.attendance.export', 'class.attendance.read.all'],
  TEACHER: ['class.attendance.manage', 'class.attendance.export'],
  SYSTEM_ADMIN: ['class.attendance.read.all', 'admin.manage_config'],
  STUDENT: ['class.attendance.read.self'],
};
const withPerms = (service: ClassAttendanceService, perms: string[]) =>
  jest.spyOn(service as any, 'getPermissions').mockResolvedValue(new Set(perms));

describe('Class attendance with live data', () => {
  it.each(['BUSINESS_ADMIN', 'TEACHER'])('filters synchronized classes without bypassing %s scope', async role => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService);
    withPerms(service, ROLE_PERMS[role]);
    await service.listClasses('user-1', '2026-11-14', 'uel_api');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('AND cs.source =');
    expect(params).toEqual(role === 'TEACHER' ? ['user-1', '2026-11-14', 'uel_api'] : ['2026-11-14', 'uel_api']);
    if (role === 'TEACHER') expect(sql).toContain('cs.lecturer_user_id = $1');
  });

  it('defaults to UEL classes so legacy sample sections cannot enter selectors or statistics', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService);
    withPerms(service, ROLE_PERMS.SYSTEM_ADMIN);
    expect(await service.listClasses('user-1', '2026-11-14')).toEqual([]);
    expect(query.mock.calls[0][0]).toContain('AND cs.source =');
    expect(query.mock.calls[0][1]).toContain('uel_api');
  });

  it('rejects unknown sources before querying classes', async () => {
    const query = jest.fn();
    const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService);
    await expect(service.listClasses('user-1', '2026-11-14', 'unknown')).rejects.toThrow('Nguồn lớp học không hợp lệ');
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the same synchronized source for reports and CSV without creating fallback classes', async () => {
    const service = new ClassAttendanceService({ manager: { query: jest.fn().mockResolvedValue([]) } } as unknown as DataSource, {} as HgVisionService);
    withPerms(service, ROLE_PERMS.TEACHER);
    const classes = jest.spyOn(service, 'listClasses').mockResolvedValue([]);
    const report = await service.getTeacherReport('user-1', { source: 'uel_api', mode: 'month', anchorDate: '2026-11-14' });
    expect(report.rows).toEqual([]);
    expect(report.totals.totalSessions).toBe(0);
    await service.exportSemesterCsv('user-1', { source: 'uel_api' });
    expect(classes).toHaveBeenCalledTimes(2);
    expect(classes).toHaveBeenLastCalledWith('user-1', undefined, 'uel_api');
  });

  describe('student cannot read whole-class data', () => {
    const makeStudentService = () => {
      const query = jest.fn().mockResolvedValue([{ id: 'class-1' }]);
      const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService);
      withPerms(service, ROLE_PERMS.STUDENT);
      jest.spyOn(service as any, 'resolveClassSectionId').mockResolvedValue('class-1');
      jest.spyOn(service, 'listClasses').mockResolvedValue([{ id: 'class-1' }] as any);
      return service;
    };

    it.each([
      ['getRows', (s: ClassAttendanceService) => s.getRows('stu-1', 'class-1', '2026-11-14')],
      ['getSummary', (s: ClassAttendanceService) => s.getSummary('stu-1', 'class-1', '2026-11-14')],
      ['getEvents', (s: ClassAttendanceService) => s.getEvents('stu-1', 'class-1', '2026-11-14')],
      ['getTeacherReport', (s: ClassAttendanceService) => s.getTeacherReport('stu-1', {})],
      ['getAbsenceWarnings', (s: ClassAttendanceService) => s.getAbsenceWarnings('stu-1', {})],
      ['exportSemesterCsv', (s: ClassAttendanceService) => s.exportSemesterCsv('stu-1', {})],
      ['getStats', (s: ClassAttendanceService) => s.getStats('stu-1')],
    ])('%s rejects a STUDENT enrolled in the class', async (_name, call) => {
      await expect(call(makeStudentService())).rejects.toThrow(/quyền/);
    });
  });

  it('does not assign an unmatched face to the next unmarked student', async () => {
    const query = jest.fn();
    const service = new ClassAttendanceService(
      { manager: { query } } as unknown as DataSource,
      {} as HgVisionService,
    );
    jest.spyOn(service as any, 'assertClassAccess').mockResolvedValue('class-1');
    jest.spyOn(service as any, 'getClassStudents').mockResolvedValue([{ id: 'student-1' }]);
    jest.spyOn(service, 'getRows').mockResolvedValue([{ studentId: 'student-1', checkInAt: null }] as any);
    jest.spyOn(service as any, 'resolveClassFaceRecognition').mockResolvedValue(null);

    const result = await service.scan('teacher-1', { classId: 'class-1', direction: 'in' });

    expect(result.data.operationSuccess).toBe(false);
    expect(result.data.warning).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not match empty or partial identity strings to a student without email', () => {
    const service = new ClassAttendanceService({} as DataSource, {} as HgVisionService);
    const students = [{ id: 's1', user_id: 'u1', code: 'SV001', name: 'Sinh viên A', email: null }];
    expect((service as any).matchStudentByFaceIdent(students, '')).toBeUndefined();
    expect((service as any).matchStudentByFaceIdent(students, 'SV00')).toBeUndefined();
    expect((service as any).matchStudentByFaceIdent(students, 'OTHER')).toBeUndefined();
    expect((service as any).matchStudentByFaceIdent(students, 'SV001')).toBe(students[0]);
  });

  it('rejects malformed lesson dates before querying the database', async () => {
    const query = jest.fn();
    const service = new ClassAttendanceService(
      { manager: { query } } as unknown as DataSource,
      {} as HgVisionService,
    );
    await expect(service.listClasses('teacher-1', 'invalid')).rejects.toThrow('Ngày học không hợp lệ');
    expect(query).not.toHaveBeenCalled();
  });
  // Quyền điểm danh lớp giờ bật/tắt được trong Bảng phân quyền (trước đây kiểm tra cứng theo vai trò).
  describe('permission-based access (class.attendance.*)', () => {
    const make = (perms: string[], rows: unknown[] = []) => {
      const query = jest.fn().mockResolvedValue(rows);
      const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService, {} as never);
      withPerms(service, perms);
      jest.spyOn(service as any, 'resolveClassSectionId').mockResolvedValue('class-1');
      return { service, query };
    };

    it('read.all (BA): xem lớp bất kỳ, không kiểm lớp mình dạy', async () => {
      const { service, query } = make(ROLE_PERMS.BUSINESS_ADMIN);
      await expect((service as any).assertClassAccess('ba-1', 'class-1', ['class.attendance.stats.read'])).resolves.toBe('class-1');
      expect(query).not.toHaveBeenCalled();
    });

    it('không có read.all (GV): chỉ lớp mình dạy — lớp khác bị từ chối', async () => {
      const { service, query } = make(ROLE_PERMS.TEACHER, []);
      await expect((service as any).assertClassAccess('t-1', 'class-1', ['class.attendance.manage'])).rejects.toThrow('Bạn không có quyền xem lớp học này.');
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('cs.lecturer_user_id = $2');
      expect(sql).not.toContain('role_code');
      expect(params).toEqual(['class-1', 't-1']);
    });

    it('thiếu quyền cần thiết → từ chối trước khi truy vấn lớp', async () => {
      const { service, query } = make(['class.attendance.export']);
      await expect((service as any).assertClassAccess('u-1', 'class-1', ['class.attendance.manage'])).rejects.toThrow('Bạn không có quyền thao tác lớp học này.');
      expect(query).not.toHaveBeenCalled();
    });

    it('scan / điểm danh tay cần class.attendance.manage (BA chỉ xem không điểm danh được)', async () => {
      const { service } = make(ROLE_PERMS.BUSINESS_ADMIN);
      await expect(service.scan('ba-1', { classId: 'class-1' })).rejects.toThrow(/quyền/);
      await expect(
        service.updateManual('ba-1', { classId: 'class-1', studentId: 's-1', status: 'late', reason: 'x', date: '2026-11-14' }),
      ).rejects.toThrow(/quyền/);
    });

    it('xuất CSV cần class.attendance.export', async () => {
      const { service } = make(['class.attendance.manage']);
      await expect(service.exportSemesterCsv('t-1', {})).rejects.toThrow('Bạn không có quyền xuất bảng chuyên cần.');
    });

    it('SA (read.all + cấu hình, không có màn chuyên cần) không xem được báo cáo lớp', async () => {
      const { service } = make(ROLE_PERMS.SYSTEM_ADMIN);
      jest.spyOn(service, 'listClasses').mockResolvedValue([]);
      await expect(service.getTeacherReport('sa-1', {})).rejects.toThrow(/quyền/);
      await expect(service.getStats('sa-1')).rejects.toThrow(/quyền/);
    });

    it('sửa cấu hình điểm danh cần admin.manage_config (GV bị từ chối)', async () => {
      const { service } = make(ROLE_PERMS.TEACHER);
      await expect(service.updateSettings('t-1', { lateThresholdMinutes: 10 })).rejects.toThrow(
        'Bạn không có quyền cập nhật cấu hình điểm danh lớp học.',
      );
    });

    it('xem chuyên cần SV khác cần quyền xem lớp; SV chỉ có read.self bị từ chối', async () => {
      const { service, query } = make(ROLE_PERMS.STUDENT);
      await expect(service.getStudentReport('stu-1', { studentId: 'other' })).rejects.toThrow('Bạn không có quyền xem chuyên cần này.');
      expect(query).not.toHaveBeenCalled();
    });

    it('xem chuyên cần của mình cần read.self (tài khoản không có quyền bị từ chối)', async () => {
      const { service } = make([]);
      await expect(service.getStudentReport('u-1', {})).rejects.toThrow('Bạn không có quyền xem chuyên cần này.');
    });

    it('GV xem SV không học lớp mình dạy → từ chối; BA (read.all) không bị giới hạn', async () => {
      const student = [{ id: 'st-1', user_id: 'u-s', code: 'SV1', name: 'A', email: null }];
      const t = make(ROLE_PERMS.TEACHER);
      t.query.mockResolvedValueOnce(student).mockResolvedValueOnce([]);
      await expect(t.service.getStudentReport('t-1', { studentId: 'SV1' })).rejects.toThrow('Sinh viên này không học lớp nào bạn phụ trách.');
      expect(t.query.mock.calls[1][1]).toEqual(['st-1', 't-1']);

      const b = make(ROLE_PERMS.BUSINESS_ADMIN);
      b.query.mockResolvedValueOnce(student).mockResolvedValue([]);
      await b.service.getStudentReport('ba-1', { studentId: 'SV1' }).catch(() => undefined);
      expect(b.query.mock.calls.some(([sql]) => String(sql).includes('cs.lecturer_user_id = $2'))).toBe(false);
    });
  });
});

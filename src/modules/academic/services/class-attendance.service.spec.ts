import { DataSource } from 'typeorm';
import { ClassAttendanceService } from './class-attendance.service';
import { HgVisionService } from './hgvision.service';

describe('Class attendance with live data', () => {
  it.each(['BUSINESS_ADMIN', 'TEACHER'])('filters synchronized classes without bypassing %s scope', async role => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService);
    jest.spyOn(service as any, 'getRoleCodes').mockResolvedValue([role]);
    await service.listClasses('user-1', '2026-11-14', 'uel_api');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('AND cs.source =');
    expect(params).toEqual(role === 'TEACHER' ? ['user-1', '2026-11-14', 'uel_api'] : ['2026-11-14', 'uel_api']);
    if (role === 'TEACHER') expect(sql).toContain('cs.lecturer_user_id = $1');
  });

  it('defaults to UEL classes so legacy sample sections cannot enter selectors or statistics', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new ClassAttendanceService({ manager: { query } } as unknown as DataSource, {} as HgVisionService);
    jest.spyOn(service as any, 'getRoleCodes').mockResolvedValue(['SYSTEM_ADMIN']);
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
    const service = new ClassAttendanceService({} as DataSource, {} as HgVisionService);
    const classes = jest.spyOn(service, 'listClasses').mockResolvedValue([]);
    const report = await service.getTeacherReport('user-1', { source: 'uel_api', mode: 'month', anchorDate: '2026-11-14' });
    expect(report.rows).toEqual([]);
    expect(report.totals.totalSessions).toBe(0);
    await service.exportSemesterCsv('user-1', { source: 'uel_api' });
    expect(classes).toHaveBeenCalledTimes(2);
    expect(classes).toHaveBeenLastCalledWith('user-1', undefined, 'uel_api');
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
});

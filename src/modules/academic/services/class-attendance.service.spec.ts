import { DataSource } from 'typeorm';
import { ClassAttendanceService } from './class-attendance.service';
import { HgVisionService } from './hgvision.service';

describe('Class attendance with live data', () => {
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

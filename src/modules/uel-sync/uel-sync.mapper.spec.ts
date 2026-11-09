import {
  eachDate,
  emailOf,
  fullNameOf,
  roomNameOf,
  semesterCodeOf,
  sessionTimesOf,
  staffRoleOf,
  toIsoDate,
} from './uel-sync.mapper';

describe('uel-sync.mapper', () => {
  it('fullNameOf ghép họ + tên, fallback mã', () => {
    expect(fullNameOf(' Nguyễn Văn ', 'An', 'NS1')).toBe('Nguyễn Văn An');
    expect(fullNameOf(null, '  ', 'NS1')).toBe('NS1');
  });

  it('emailOf giữ email hợp lệ, sinh email nội bộ khi thiếu/sai', () => {
    expect(emailOf(' AnNV@UEL.edu.vn ', 'NS1')).toBe('annv@uel.edu.vn');
    expect(emailOf(null, 'K224111')).toBe('k224111@no-email.uel.local');
    expect(emailOf('khong-hop-le', 'K1')).toBe('k1@no-email.uel.local');
  });

  it('staffRoleOf nhận diện giảng viên (có/không dấu)', () => {
    expect(staffRoleOf('Giảng viên')).toBe('TEACHER');
    expect(staffRoleOf('GIANG VIEN')).toBe('TEACHER');
    expect(staffRoleOf('GV')).toBe('TEACHER');
    expect(staffRoleOf('Chuyên viên')).toBe('EMPLOYEE');
    expect(staffRoleOf(null)).toBe('EMPLOYEE');
  });

  it('semesterCodeOf', () => {
    expect(semesterCodeOf(' 2025-2026 ', '1')).toBe('2025-2026_HK1');
  });

  it('toIsoDate nhận yyyy-MM-dd, ISO, dd/MM/yyyy', () => {
    expect(toIsoDate('2026-11-09')).toBe('2026-11-09');
    expect(toIsoDate('2026-11-09T00:00:00')).toBe('2026-11-09');
    expect(toIsoDate('9/11/2026')).toBe('2026-11-09');
    expect(toIsoDate('abc')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });

  it('sessionTimesOf tính giờ từ tiết đầu đến tiết cuối', () => {
    const periods = new Map([
      [1, { startTime: '07:00:00', endTime: '07:50:00' }],
      [2, { startTime: '07:50', endTime: '08:40' }],
      [3, { startTime: '08:50:00', endTime: '09:40:00' }],
    ]);
    expect(sessionTimesOf('2026-11-09', 1, 3, periods)).toEqual({
      start: '2026-11-09T07:00:00+07:00',
      end: '2026-11-09T09:40:00+07:00',
    });
    expect(sessionTimesOf('2026-11-09', 2, 1, periods)).toEqual({
      start: '2026-11-09T07:50:00+07:00',
      end: '2026-11-09T08:40:00+07:00',
    });
    expect(sessionTimesOf('2026-11-09', 2, 5, periods)).toBeNull();
    expect(sessionTimesOf('2026-11-09', null, 2, periods)).toBeNull();
  });

  it('eachDate liệt kê cả 2 đầu, qua tháng', () => {
    expect(eachDate('2026-11-29', '2026-12-02')).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
  });

  it('roomNameOf kèm cơ sở', () => {
    expect(roomNameOf('A.101', 'A101', 'Cơ sở chính')).toBe(
      'A.101 - Cơ sở chính',
    );
    expect(roomNameOf(null, 'A101', null)).toBe('A101');
  });
});

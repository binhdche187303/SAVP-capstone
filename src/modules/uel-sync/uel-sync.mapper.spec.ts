import {
  codeListOf,
  cohortOfClass,
  eachDate,
  isCohortInScope,
  emailOf,
  fullNameOf,
  roomNameOf,
  semesterCodeOf,
  semesterNameOf,
  sessionTimesFromClock,
  sessionTimesOf,
  staffRoleOf,
  toIsoDate,
  toUelDate,
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

  it('staffRoleOf theo dữ liệu thật: TG → TEACHER; CH theo đơn vị', () => {
    expect(staffRoleOf('TG')).toBe('TEACHER');
    expect(staffRoleOf(' tg ')).toBe('TEACHER');
    expect(staffRoleOf('CH')).toBe('EMPLOYEE');
    expect(staffRoleOf('CH', true)).toBe('TEACHER');
    expect(staffRoleOf('TG', false)).toBe('TEACHER');
  });

  it('semesterCodeOf chuẩn hóa về HKnn, không lặp HKHK', () => {
    expect(semesterCodeOf(' 2025-2026 ', '1')).toBe('2025-2026_HK01');
    expect(semesterCodeOf('2026-2027', 'HK01')).toBe('2026-2027_HK01');
    expect(semesterCodeOf('2026-2027', ' hk3 ')).toBe('2026-2027_HK03');
    expect(semesterNameOf('2026-2027', 'HK01')).toBe(
      'Học kỳ 1 năm học 2026-2027',
    );
  });

  it('toIsoDate nhận yyyy-MM-dd, ISO, dd/MM/yyyy', () => {
    expect(toIsoDate('2026-11-09')).toBe('2026-11-09');
    expect(toIsoDate('2026-11-09T00:00:00')).toBe('2026-11-09');
    expect(toIsoDate('9/11/2026')).toBe('2026-11-09');
    expect(toIsoDate('abc')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });

  it('toUelDate đổi sang dd/MM/yyyy cho API TKB UEL', () => {
    expect(toUelDate('2026-11-09')).toBe('09/11/2026');
    expect(toUelDate('9/11/2026')).toBe('09/11/2026');
    expect(toUelDate('abc')).toBe('abc');
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

  it('sessionTimesFromClock dùng giờ API, sai/thiếu → null', () => {
    expect(sessionTimesFromClock('2026-11-12', '07:00', '11:00')).toEqual({
      start: '2026-11-12T07:00:00+07:00',
      end: '2026-11-12T11:00:00+07:00',
    });
    expect(sessionTimesFromClock('2026-11-12', '7:30', '9:15:00')).toEqual({
      start: '2026-11-12T07:30:00+07:00',
      end: '2026-11-12T09:15:00+07:00',
    });
    expect(sessionTimesFromClock('2026-11-12', null, '11:00')).toBeNull();
    expect(sessionTimesFromClock('2026-11-12', '11:00', '07:00')).toBeNull();
    expect(sessionTimesFromClock('2026-11-12', '25:00', '26:00')).toBeNull();
    expect(sessionTimesFromClock('2026-11-12', 'sáng', '11:00')).toBeNull();
  });

  it('codeListOf tách mã, bỏ trống/trùng', () => {
    expect(codeListOf(['GV0001', ' GV0001 ', '', '22.001'])).toEqual([
      'GV0001',
      '22.001',
    ]);
    expect(codeListOf('GV0001, 22.001\nK240000001')).toEqual([
      'GV0001',
      '22.001',
      'K240000001',
    ]);
    expect(codeListOf(undefined)).toEqual([]);
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

  it('cohortOfClass đọc khóa từ mã lớp UEL', () => {
    expect(cohortOfClass('K22406')).toBe(22);
    expect(cohortOfClass('C22603BT-2')).toBe(22);
    expect(cohortOfClass('k19405T')).toBe(19);
    expect(cohortOfClass('B17501.DKH')).toBe(17);
    expect(cohortOfClass('K08403')).toBe(8);
    expect(cohortOfClass('IE2026')).toBe(26);
    expect(cohortOfClass('BSKTSDH2019')).toBe(19);
    expect(cohortOfClass('BCU IB04')).toBeNull();
    expect(cohortOfClass(null)).toBeNull();
  });

  it('isCohortInScope: giữ từ K22, giữ lớp không rõ khóa', () => {
    expect(isCohortInScope('K22406', 22)).toBe(true);
    expect(isCohortInScope('K26401', 22)).toBe(true);
    expect(isCohortInScope('K21401', 22)).toBe(false);
    expect(isCohortInScope('K08403', 22)).toBe(false);
    expect(isCohortInScope('TDSVUEB2024', 22)).toBe(true);
    expect(isCohortInScope('BSKTSDH2019', 22)).toBe(false);
    expect(isCohortInScope('BCU IB04', 22)).toBe(true);
  });
});

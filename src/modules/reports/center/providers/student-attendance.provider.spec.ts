import { STUDENT_ABSENCE_WARNING_RATIO, toStudentRow } from './student-attendance.provider.js';

describe('toStudentRow', () => {
  it('tỷ lệ = (số buổi − vắng) / số buổi, làm tròn 1 chữ số', () => {
    expect(toStudentRow({ sessions: 3, present: 0, late: 1, absent: 2 }).rate).toBe(33.3);
    expect(toStudentRow({ sessions: 10, present: 10, late: 0, absent: 0 }).rate).toBe(100);
  });
  it('đi muộn vẫn tính là có mặt', () => {
    expect(toStudentRow({ sessions: 4, present: 0, late: 4, absent: 0 }).rate).toBe(100);
  });
  it('cảnh báo khi vắng QUÁ 20%, đúng 20% thì chưa', () => {
    expect(STUDENT_ABSENCE_WARNING_RATIO).toBe(0.2);
    expect(toStudentRow({ sessions: 10, present: 8, late: 0, absent: 2 }).warning).toBe('');
    expect(toStudentRow({ sessions: 10, present: 7, late: 0, absent: 3 }).warning).toBe('Vắng quá 20%');
  });
  it('không có buổi nào → 0%, không cảnh báo, không chia cho 0', () => {
    expect(toStudentRow({ sessions: 0, present: 0, late: 0, absent: 0 })).toEqual({ rate: 0, warning: '' });
  });
});

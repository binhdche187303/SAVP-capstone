/**
 * ACD-001 D5/R12 — tính thời điểm thực của 1 buổi học = ngày học + giờ ca (giờ địa phương VN).
 * Việt Nam cố định UTC+07:00, không DST → ghép offset trực tiếp, không cần thư viện múi giờ.
 * Kết quả ghi vào class_sessions.start_time/end_time (snapshot). Dùng lại ở #23.
 */
const VN_OFFSET = '+07:00';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function toInstant(sessionDate: string, time: string): Date {
  if (!DATE_RE.test(sessionDate))
    throw new Error(`Ngày học không hợp lệ: ${sessionDate}`);
  if (!TIME_RE.test(time)) throw new Error(`Giờ ca không hợp lệ: ${time}`);
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  const instant = new Date(`${sessionDate}T${hhmmss}${VN_OFFSET}`);
  // Chặn ngày không tồn tại (vd 2026-02-30 bị Date tự cuộn sang tháng 3).
  const vnDate = new Date(instant.getTime() + 7 * 3_600_000)
    .toISOString()
    .slice(0, 10);
  if (Number.isNaN(instant.getTime()) || vnDate !== sessionDate) {
    throw new Error(`Ngày học không tồn tại: ${sessionDate}`);
  }
  return instant;
}

export function buildSessionTimes(
  sessionDate: string,
  shiftStart: string,
  shiftEnd: string,
): { startTime: Date; endTime: Date } {
  const startTime = toInstant(sessionDate, shiftStart);
  const endTime = toInstant(sessionDate, shiftEnd);
  if (endTime <= startTime) {
    throw new Error(
      `Giờ kết thúc ca (${shiftEnd}) phải sau giờ bắt đầu (${shiftStart})`,
    );
  }
  return { startTime, endTime };
}

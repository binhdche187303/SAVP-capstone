/**
 * Tính cờ trễ / về sớm cho điểm danh thủ công (UC-B21, spec §5.3).
 * Hàm THUẦN — KHÔNG phụ thuộc Nest; dùng chung cho createManual + updateProfile.
 *
 * [2026-08-22] graceMinutes BẮT BUỘC truyền vào (không default ngầm) — trước
 * đây hàm này tính no-grace tuyệt đối trong khi FaceAttendanceService (camera)
 * đọc system_configs['attendance.late_grace_minutes'], khiến điểm danh thủ
 * công và camera có thể cho isLate khác nhau ở cùng 1 mốc trễ. Gọi
 * getAttendanceLateGraceMinutes() (cùng nguồn cấu hình với camera) trước rồi
 * truyền kết quả vào đây — xem get-late-grace-minutes.util.ts.
 *
 * Công thức:
 *   isLate      = checkInTime > startTime + graceMinutes phút
 *   lateMinutes = late ? max(1, ceil(diffMs / 60000)) : 0   (diff tính từ startTime, KHÔNG trừ grace)
 *   leftEarly   = checkOutTime != null && endTime != null && checkOutTime < endTime - earlyLeaveMinutes phút
 *               (endTime null → leftEarly = false; không liên quan graceMinutes)
 */
export interface LateFlags {
  isLate: boolean;
  lateMinutes: number;
  leftEarly: boolean;
}

export function computeLateFlags(
  checkInTime: Date,
  startTime: Date,
  checkOutTime: Date | null,
  endTime: Date | null,
  graceMinutes: number,
  earlyLeaveMinutes = 0,
): LateFlags {
  const graceMs = graceMinutes * 60_000;
  const isLate = checkInTime.getTime() > startTime.getTime() + graceMs;
  const lateMinutes = isLate
    ? Math.max(
        1,
        Math.ceil((checkInTime.getTime() - startTime.getTime()) / 60000),
      )
    : 0;

  const leftEarly =
    checkOutTime !== null &&
    endTime !== null &&
    checkOutTime.getTime() < endTime.getTime() - earlyLeaveMinutes * 60_000;

  return { isLate, lateMinutes, leftEarly };
}

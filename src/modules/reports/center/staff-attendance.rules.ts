// Quy tắc chuyên cần cán bộ (RPT-CENTER-BE-001 §4.1) — hàm thuần, không đụng DB. Giờ Việt Nam là UTC+7 cố định.
export interface StaffAttendanceRules {
  workStart: string;
  workEnd: string;
  graceMinutes: number;
  /** 0 = Chủ nhật … 6 = thứ Bảy. */
  workdays: number[];
}

export const DEFAULT_STAFF_ATTENDANCE_RULES: StaffAttendanceRules = {
  workStart: '08:00',
  workEnd: '17:00',
  graceMinutes: 15,
  workdays: [1, 2, 3, 4, 5],
};

export type DayStatus = 'on_time' | 'late' | 'early_leave' | 'late_and_early' | 'absent' | 'pending' | 'off';
export interface DayResult { status: DayStatus; hours: number }

const VN_OFFSET_MS = 7 * 3_600_000;
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
/** Phút trong ngày (giờ VN, bỏ giây) của một thời điểm. */
const vnMinuteOfDay = (d: Date): number => {
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};
export const vnYmd = (d: Date): string => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

export const isWorkday = (ymd: string, rules: StaffAttendanceRules): boolean => rules.workdays.includes(new Date(`${ymd}T00:00:00Z`).getUTCDay());

/** Các ngày làm việc trong [from, to] (đã cắt tới hôm nay: ngày tương lai không tính). */
export function workdaysInRange(from: string, to: string, rules: StaffAttendanceRules, now: Date): string[] {
  const today = vnYmd(now);
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const ymd = new Date(t).toISOString().slice(0, 10);
    if (ymd <= today && isWorkday(ymd, rules)) days.push(ymd);
  }
  return days;
}

/**
 * Phân loại một ngày làm việc của một cán bộ.
 * - Không có lần thấy: vắng; riêng hôm nay chưa hết giờ làm thì `pending` (chưa kết luận).
 * - Lần thấy đầu sau `workStart + graceMinutes` (tính theo phút) → đi muộn.
 * - Lần thấy cuối trước `workEnd` → về sớm; riêng hôm nay chưa hết giờ làm thì không tính về sớm.
 */
export function classifyDay(
  seen: { firstSeen: Date; lastSeen: Date } | null,
  ymd: string,
  rules: StaffAttendanceRules,
  now: Date,
): DayResult {
  if (!isWorkday(ymd, rules)) return { status: 'off', hours: 0 };
  const dayOver = ymd < vnYmd(now) || vnMinuteOfDay(now) >= toMinutes(rules.workEnd);
  if (!seen) return { status: dayOver ? 'absent' : 'pending', hours: 0 };
  const late = vnMinuteOfDay(seen.firstSeen) > toMinutes(rules.workStart) + rules.graceMinutes;
  const early = dayOver && vnMinuteOfDay(seen.lastSeen) < toMinutes(rules.workEnd);
  const hours = Math.max(0, (seen.lastSeen.getTime() - seen.firstSeen.getTime()) / 3_600_000);
  const status: DayStatus = late && early ? 'late_and_early' : late ? 'late' : early ? 'early_leave' : 'on_time';
  return { status, hours };
}

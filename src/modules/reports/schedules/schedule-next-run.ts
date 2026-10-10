// Lịch gửi báo cáo (spec RPT-CENTER-BE-001 §6.2, BR-S2/S4/S7). Chép từ FE `scheduleNextRun.js`.
// Giờ theo Asia/Ho_Chi_Minh = UTC+7 cố định, tự tính bằng UTC để kết quả không phụ thuộc múi giờ máy chủ (production chạy UTC).

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';
export type SchedulePeriod = 'yesterday' | 'last_week' | 'last_month';

export interface NextRunSchedule {
  enabled: boolean;
  frequency: ScheduleFrequency | string;
  /** "HH:mm" giờ Việt Nam. */
  time: string;
  /** 0 = Chủ nhật … 6 = thứ Bảy (tần suất tuần). */
  dayOfWeek?: number | null;
  /** 1–28 hoặc 'last' (tần suất tháng). */
  dayOfMonth?: number | 'last' | null;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Date mà các getter getUTC* đọc ra đúng giờ treo tường Việt Nam.
const toVn = (date: Date): Date => new Date(date.getTime() + VN_OFFSET_MS);
// Thời điểm thật ứng với giờ treo tường Việt Nam (ngày/tháng tràn được tự chuẩn hoá).
const fromVn = (y: number, m: number, d: number, hh = 0, mm = 0): Date => new Date(Date.UTC(y, m, d, hh, mm) - VN_OFFSET_MS);
const lastDayOfMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function computeNextRun(schedule: NextRunSchedule, now: Date = new Date()): Date | null {
  if (!schedule?.enabled) return null;
  const [hh, mm] = schedule.time.split(':').map(Number);
  const vn = toVn(now);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const d = vn.getUTCDate();

  if (schedule.frequency === 'daily') {
    const today = fromVn(y, m, d, hh, mm);
    return today > now ? today : fromVn(y, m, d + 1, hh, mm);
  }
  if (schedule.frequency === 'weekly') {
    for (let i = 0; i <= 7; i += 1) {
      const candidate = fromVn(y, m, d + i, hh, mm);
      if (toVn(candidate).getUTCDay() === schedule.dayOfWeek && candidate > now) return candidate;
    }
  }
  if (schedule.frequency === 'monthly') {
    for (let i = 0; i <= 2; i += 1) {
      const first = new Date(Date.UTC(y, m + i, 1));
      const yy = first.getUTCFullYear();
      const mo = first.getUTCMonth();
      const day = schedule.dayOfMonth === 'last' ? lastDayOfMonth(yy, mo) : (schedule.dayOfMonth as number);
      const candidate = fromVn(yy, mo, day, hh, mm);
      if (candidate > now) return candidate;
    }
  }
  throw new Error(`Tần suất không hợp lệ: ${schedule.frequency}`);
}

/** Kỳ dữ liệu (YYYY-MM-DD, giờ Việt Nam) của một lần chạy tại thời điểm `now`. */
export function resolvePeriod(period: SchedulePeriod | string, now: Date = new Date()): { from: string; to: string } {
  const vn = toVn(now);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const d = vn.getUTCDate();
  const at = (yy: number, mo: number, dd: number): Date => new Date(Date.UTC(yy, mo, dd));

  if (period === 'yesterday') {
    const day = ymd(at(y, m, d - 1));
    return { from: day, to: day };
  }
  if (period === 'last_week') {
    const sinceMonday = (vn.getUTCDay() + 6) % 7;
    return { from: ymd(at(y, m, d - sinceMonday - 7)), to: ymd(at(y, m, d - sinceMonday - 1)) };
  }
  if (period === 'last_month') {
    return { from: ymd(at(y, m - 1, 1)), to: ymd(at(y, m, 0)) };
  }
  throw new Error(`Kỳ dữ liệu không hợp lệ: ${period}`);
}

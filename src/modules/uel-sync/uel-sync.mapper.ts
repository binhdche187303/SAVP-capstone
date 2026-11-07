/**
 * Hàm thuần chuyển dữ liệu API UEL → giá trị cột SAVP. Không đụng DB để dễ test.
 */

/** Chuỗi rỗng / khoảng trắng → null. */
export function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
}

export function fullNameOf(
  ho: string | null,
  ten: string | null,
  fallback: string,
): string {
  const name = [clean(ho), clean(ten)].filter(Boolean).join(' ');
  return name || fallback;
}

/** Email hợp lệ thì dùng (lowercase), không thì sinh email nội bộ theo mã để giữ ràng buộc NOT NULL + unique. */
export function emailOf(email: string | null, code: string): string {
  const e = clean(email)?.toLowerCase() ?? null;
  if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  return `${code.toLowerCase()}@no-email.uel.local`;
}

export function usernameOf(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * Role theo trường `loai` của ds_nhansu. Tài liệu chưa nêu giá trị cụ thể ⇒ nhận diện theo
 * từ khóa "giảng viên"/"GV"; còn lại là EMPLOYEE. Cần đối chiếu lại với dữ liệu thật.
 */
export function staffRoleOf(loai: string | null): 'TEACHER' | 'EMPLOYEE' {
  const l = (clean(loai) ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
  return /giang vien|^gv\b|lecturer|teacher/.test(l) ? 'TEACHER' : 'EMPLOYEE';
}

/** Mã học kỳ SAVP từ nam_hoc + hoc_ky, vd "2025-2026" + "1" → "2025-2026_HK1". */
export function semesterCodeOf(namHoc: string, hocKy: string): string {
  return `${namHoc.trim()}_HK${hocKy.trim()}`;
}

/**
 * Chuẩn hóa ngày về yyyy-MM-dd. Chấp nhận yyyy-MM-dd, ISO date-time, dd/MM/yyyy.
 * Trả null nếu không nhận dạng được.
 */
export function toIsoDate(v: string | null): string | null {
  const s = clean(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export interface PeriodTime {
  startTime: string; // HH:mm[:ss]
  endTime: string;
}

/**
 * Giờ bắt đầu/kết thúc buổi học (giờ VN, +07:00) từ tiết bắt đầu + số tiết.
 * Null khi thiếu dữ liệu hoặc bảng study_periods chưa có tiết tương ứng.
 */
export function sessionTimesOf(
  isoDate: string,
  tietBatDau: number | null,
  soTiet: number | null,
  periods: ReadonlyMap<number, PeriodTime>,
): { start: string; end: string } | null {
  if (!tietBatDau || !soTiet || tietBatDau < 1 || soTiet < 1) return null;
  const first = periods.get(tietBatDau);
  const last = periods.get(tietBatDau + soTiet - 1);
  if (!first || !last) return null;
  const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));
  return {
    start: `${isoDate}T${hhmmss(first.startTime)}+07:00`,
    end: `${isoDate}T${hhmmss(last.endTime)}+07:00`,
  };
}

/** Liệt kê các ngày yyyy-MM-dd trong [from, to]. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Tên phòng duy nhất (rooms.room_name unique): kèm cơ sở khi có. */
export function roomNameOf(
  tenPhong: string | null,
  maPhong: string,
  tenCoSo: string | null,
): string {
  const base = clean(tenPhong) ?? maPhong;
  const cs = clean(tenCoSo);
  return cs ? `${base} - ${cs}` : base;
}

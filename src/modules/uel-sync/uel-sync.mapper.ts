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
 * Role cán bộ. Dữ liệu thật: `loai` chỉ có "TG" (thỉnh giảng) / "CH" (cơ hữu) ⇒
 * - TG → TEACHER (thỉnh giảng = người dạy).
 * - CH thuộc đơn vị học thuật (Khoa / Bộ môn, kể cả cấp con) → TEACHER; Phòng/Ban/Viện… → EMPLOYEE.
 * - Vẫn nhận từ khóa "giảng viên"/"GV" nếu UEL đổi giá trị `loai`.
 * Người dạy ở Phòng/Viện được bổ sung TEACHER khi đồng bộ lớp HP / lịch học (theo mã GV).
 */
export function staffRoleOf(
  loai: string | null,
  inAcademicUnit = false,
): 'TEACHER' | 'EMPLOYEE' {
  const l = (clean(loai) ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
  if (l === 'tg' || /giang vien|^gv\b|lecturer|teacher/.test(l))
    return 'TEACHER';
  return inAcademicUnit ? 'TEACHER' : 'EMPLOYEE';
}

/** Số học kỳ từ hoc_ky UEL: "HK01" / "hk1" / "1" → 1. Không nhận dạng được → null. */
function semesterNoOf(hocKy: string): number | null {
  const m = /^(?:hk)?\s*0*(\d{1,2})$/i.exec(hocKy.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Mã học kỳ SAVP từ nam_hoc + hoc_ky, chuẩn hóa về HKnn:
 * "2025-2026" + "HK01" | "1" → "2025-2026_HK01" (không lặp "HKHK").
 */
export function semesterCodeOf(namHoc: string, hocKy: string): string {
  const no = semesterNoOf(hocKy);
  const part =
    no !== null
      ? `HK${String(no).padStart(2, '0')}`
      : hocKy.trim().toUpperCase();
  return `${namHoc.trim()}_${part}`;
}

/** Tên hiển thị học kỳ, vd "Học kỳ 1 năm học 2025-2026". */
export function semesterNameOf(namHoc: string, hocKy: string): string {
  const no = semesterNoOf(hocKy);
  return `Học kỳ ${no ?? hocKy.trim()} năm học ${namHoc.trim()}`;
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

/** "7:00" / "07:00" / "07:00:00" → "07:00:00"; sai định dạng → null. */
function clockOf(v: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clean(v) ?? '');
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(mi)}:${p(s)}`;
}

/**
 * Giờ buổi học (+07:00) từ gio_bat_dau / gio_ket_thuc API trả kèm (vd "07:00" → "11:00").
 * Null khi thiếu / sai định dạng / kết thúc không sau bắt đầu ⇒ dùng bảng tiết thay thế.
 */
export function sessionTimesFromClock(
  isoDate: string,
  gioBatDau: string | null | undefined,
  gioKetThuc: string | null | undefined,
): { start: string; end: string } | null {
  const a = clockOf(gioBatDau);
  const b = clockOf(gioKetThuc);
  if (!a || !b || b <= a) return null;
  return { start: `${isoDate}T${a}+07:00`, end: `${isoDate}T${b}+07:00` };
}

/** Danh sách mã nhập tay: tách dấu phẩy/khoảng trắng/xuống dòng, bỏ trùng, giữ thứ tự. */
export function codeListOf(
  v: readonly string[] | string | null | undefined,
): string[] {
  const parts = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/);
  const out: string[] = [];
  for (const p of parts) {
    const c = clean(p);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
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

/**
 * Khóa (2 chữ số) suy từ mã lớp SV:
 * - 1 chữ cái + 2 số: "K22406" → 22, "C22603BT" → 22, "k19405T" → 19, "B17501.DKH" → 17.
 * - Có năm 4 số: "IE2026" → 26, "TDSVUEB2024" → 24, "BSKTSDH2019" → 19.
 * - Không suy được ("BCU IB04", "MCL K1") → null.
 */
export function cohortOfClass(maLop: string | null): number | null {
  const c = clean(maLop);
  if (!c) return null;
  const short = /^[A-Za-z](\d{2})/.exec(c);
  if (short) return Number(short[1]);
  const year = /(?:^|\D)20(\d{2})(?!\d{2})/.exec(c);
  return year ? Number(year[1]) : null;
}

/** Lớp có thuộc khóa cần đồng bộ không. Không suy được khóa ⇒ giữ (tránh bỏ sót SV đang học). */
export function isCohortInScope(
  maLop: string | null,
  minCohort: number,
): boolean {
  const k = cohortOfClass(maLop);
  return k === null || k >= minCohort;
}

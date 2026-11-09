import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { clean } from './uel-sync.mapper.js';
import type { UelSyncOptions, UelSyncStep } from './uel-sync.service.js';

export interface UelSyncSettings {
  /** nam_hoc của học kỳ hiện tại, vd "2026-2027". Trống = lịch tự động bỏ qua lớp HP + đăng ký. */
  namHoc: string;
  hocKy: string;
  /** Số ngày lịch học kéo trước tính từ hôm nay. */
  sessionDaysAhead: number;
}

export interface StudyPeriod {
  periodNo: number;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

const KEYS = {
  namHoc: 'uel_sync.nam_hoc',
  hocKy: 'uel_sync.hoc_ky',
  sessionDaysAhead: 'uel_sync.session_days_ahead',
} as const;

export const DEFAULT_SESSION_DAYS_AHEAD = 14;
export const MAX_SESSION_DAYS_AHEAD = 120;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Kiểm tra bảng tiết: số tiết dương, không trùng, giờ HH:mm, kết thúc > bắt đầu, không chồng lên tiết trước. */
export function validatePeriods(periods: StudyPeriod[]): StudyPeriod[] {
  const sorted = [...periods].sort((a, b) => a.periodNo - b.periodNo);
  const errors: string[] = [];
  sorted.forEach((p, i) => {
    if (!Number.isInteger(p.periodNo) || p.periodNo < 1 || p.periodNo > 30) {
      errors.push(`Tiết ${p.periodNo}: số tiết phải từ 1 đến 30.`);
    }
    if (!HHMM.test(p.startTime) || !HHMM.test(p.endTime)) {
      errors.push(`Tiết ${p.periodNo}: giờ phải có dạng HH:mm.`);
      return;
    }
    if (p.endTime <= p.startTime) {
      errors.push(`Tiết ${p.periodNo}: giờ kết thúc phải sau giờ bắt đầu.`);
    }
    const prev = sorted[i - 1];
    if (prev && prev.periodNo === p.periodNo) {
      errors.push(`Tiết ${p.periodNo} bị trùng.`);
    } else if (prev && HHMM.test(prev.endTime) && p.startTime < prev.endTime) {
      errors.push(
        `Tiết ${p.periodNo} bắt đầu trước khi tiết ${prev.periodNo} kết thúc.`,
      );
    }
  });
  if (errors.length) throw new BadRequestException(errors);
  return sorted;
}

/** Ngày yyyy-MM-dd theo giờ Việt Nam. */
export function vnDate(d: Date, addDays = 0): string {
  const t = new Date(d.getTime() + 7 * 3600_000 + addDays * 86400_000);
  return t.toISOString().slice(0, 10);
}

/**
 * Tham số cho lượt đồng bộ tự động: luôn chạy đơn vị, cán bộ, SV; lớp HP + đăng ký chỉ khi đã cài
 * học kỳ hiện tại; lịch học (hôm nay → +N ngày) chỉ khi đã có bảng giờ tiết.
 */
export function scheduledOptionsOf(
  s: UelSyncSettings,
  now: Date,
  hasPeriods: boolean,
): { options: UelSyncOptions; skipped: string[] } {
  const steps: UelSyncStep[] = ['departments', 'staff', 'students'];
  const skipped: string[] = [];
  const options: UelSyncOptions = { steps };
  if (s.namHoc && s.hocKy) {
    steps.push('sections', 'enrollments');
    options.namHoc = s.namHoc;
    options.hocKy = s.hocKy;
  } else {
    skipped.push('Lớp HP và đăng ký: chưa cài học kỳ hiện tại.');
  }
  if (hasPeriods) {
    steps.push('sessions');
    options.fromDate = vnDate(now);
    options.toDate = vnDate(now, Math.max(0, s.sessionDaysAhead - 1));
  } else {
    skipped.push('Lịch học: chưa nhập bảng giờ tiết.');
  }
  return { options, skipped };
}

/** Cài đặt đồng bộ UEL (system_configs nhóm uel_sync) + bảng giờ tiết (study_periods). */
@Injectable()
export class UelSyncSettingsService {
  constructor(private readonly db: DataSource) {}

  async getSettings(): Promise<UelSyncSettings> {
    const rows = await this.db.query<
      { config_key: string; config_value: string | null }[]
    >(
      `SELECT config_key, config_value FROM system_configs
        WHERE config_key = ANY($1) AND is_active = true`,
      [Object.values(KEYS)],
    );
    const v = new Map(rows.map((r) => [r.config_key, r.config_value]));
    const days = Number(v.get(KEYS.sessionDaysAhead));
    return {
      namHoc: clean(v.get(KEYS.namHoc)) ?? '',
      hocKy: clean(v.get(KEYS.hocKy)) ?? '',
      sessionDaysAhead:
        Number.isInteger(days) && days >= 1 && days <= MAX_SESSION_DAYS_AHEAD
          ? days
          : DEFAULT_SESSION_DAYS_AHEAD,
    };
  }

  async updateSettings(
    patch: Partial<UelSyncSettings>,
    userId: string | null,
  ): Promise<UelSyncSettings> {
    const next = { ...(await this.getSettings()), ...patch };
    next.namHoc = clean(next.namHoc) ?? '';
    next.hocKy = clean(next.hocKy) ?? '';
    if (!!next.namHoc !== !!next.hocKy) {
      throw new BadRequestException(
        'Cần nhập cả năm học và học kỳ, hoặc để trống cả hai.',
      );
    }
    const values: [string, string][] = [
      [KEYS.namHoc, next.namHoc],
      [KEYS.hocKy, next.hocKy],
      [KEYS.sessionDaysAhead, String(next.sessionDaysAhead)],
    ];
    await this.db.transaction(async (m) => {
      for (const [key, value] of values) {
        const res = await m.query<unknown>(
          `UPDATE system_configs
              SET config_value = $2, updated_by = $3, updated_at = now(), version_no = version_no + 1
            WHERE config_key = $1 AND config_value IS DISTINCT FROM $2`,
          [key, value, userId],
        );
        const changed = Array.isArray(res) && res[1] === 1;
        if (!changed) {
          // Khóa chưa có (DB chưa seed) thì tạo; đã có và không đổi thì bỏ qua.
          await m.query(
            `INSERT INTO system_configs (config_key, config_value, value_type, config_group, updated_by)
             SELECT $1::varchar, $2::text, 'string', 'uel_sync', $3::uuid
              WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1::varchar)`,
            [key, value, userId],
          );
        }
      }
    });
    return this.getSettings();
  }

  async getPeriods(): Promise<StudyPeriod[]> {
    const rows = await this.db.query<
      { period_no: number; s: string; e: string }[]
    >(
      `SELECT period_no, to_char(start_time, 'HH24:MI') AS s, to_char(end_time, 'HH24:MI') AS e
         FROM study_periods WHERE is_active = true ORDER BY period_no`,
    );
    return rows.map((r) => ({
      periodNo: Number(r.period_no),
      startTime: r.s,
      endTime: r.e,
    }));
  }

  /** Thay toàn bộ bảng giờ tiết. Buổi học đã đồng bộ giữ giờ cũ đến lần đồng bộ lịch học kế tiếp. */
  async replacePeriods(periods: StudyPeriod[]): Promise<StudyPeriod[]> {
    const valid = validatePeriods(periods);
    await this.db.transaction(async (m) => {
      await m.query(`DELETE FROM study_periods`);
      for (const p of valid) {
        await m.query(
          `INSERT INTO study_periods (period_no, start_time, end_time) VALUES ($1, $2, $3)`,
          [p.periodNo, p.startTime, p.endTime],
        );
      }
    });
    return this.getPeriods();
  }
}

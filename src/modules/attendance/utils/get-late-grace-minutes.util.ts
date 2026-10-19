import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';

const logger = new Logger('AttendanceLateGraceMinutes');
const DEFAULT_LATE_GRACE_MINUTES = 0;

/**
 * NC-2: system_configs['attendance.late_grace_minutes'] → env
 * ATTENDANCE_LATE_GRACE_MINUTES → default 0.
 *
 * Nguồn DUY NHẤT cho ân hạn đi muộn — dùng chung cho điểm danh camera
 * (FaceAttendanceService.onVerify) và điểm danh thủ công
 * (ManualAttendanceService.createManual/updateProfile qua computeLateFlags),
 * để 2 luồng không bao giờ lệch nhau. Trước đây logic này chỉ tồn tại
 * private trong FaceAttendanceService; tách ra hàm thuần để dùng chung
 * mà không phải import chéo module (chỉ import file, không qua NestJS DI).
 */
export async function getAttendanceLateGraceMinutes(
  manager: EntityManager,
  configService: ConfigService,
): Promise<number> {
  try {
    const rows: Array<{ config_value: string | null }> = await manager.query(
      `SELECT config_value FROM system_configs WHERE config_key = 'attendance.late_grace_minutes' LIMIT 1`,
    );
    const raw = rows?.[0]?.config_value;
    if (raw != null && raw !== '') {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch (e) {
    logger.warn(
      `read attendance.late_grace_minutes failed: ${
        e instanceof Error ? e.message : 'unknown'
      }`,
    );
  }
  return configService.get<number>(
    'ATTENDANCE_LATE_GRACE_MINUTES',
    DEFAULT_LATE_GRACE_MINUTES,
  );
}

const DEFAULT_EARLY_LEAVE_MINUTES = 15;

/** system_configs['attendance.early_leave_threshold_minutes'] → default 15 (Lịch tuần UEL). */
export async function getAttendanceEarlyLeaveMinutes(
  manager: EntityManager,
): Promise<number> {
  try {
    const rows: Array<{ config_value: string | null }> = await manager.query(
      `SELECT config_value FROM system_configs WHERE config_key = 'attendance.early_leave_threshold_minutes' LIMIT 1`,
    );
    const n = parseInt(rows?.[0]?.config_value ?? '', 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  } catch (e) {
    logger.warn(
      `read attendance.early_leave_threshold_minutes failed: ${
        e instanceof Error ? e.message : 'unknown'
      }`,
    );
  }
  return DEFAULT_EARLY_LEAVE_MINUTES;
}

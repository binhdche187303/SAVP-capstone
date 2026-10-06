import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SecurityAlertConfigService } from './security-alert-config.service.js';

interface IdRow {
  id: string;
}

export interface AutoResolveResult {
  scanned: number;
  resolved: number;
}

/**
 * SecurityAlertAutoResolveService — cron dọn dẹp ĐỘC LẬP, KHÔNG đụng
 * recordAlert()/dedupe (AlertsService). Alert đang mở (status <> 'resolved')
 * không tái phát mới (COALESCE(last_seen_at, triggered_at) — KHÔNG dùng
 * updated_at vì bị acknowledge() [hành động con người] làm nhiễu) trong N
 * phút → tự động resolved. N cấu hình qua SecurityAlertConfigService
 * (system_configs, mặc định 15 phút nếu chưa cấu hình).
 *
 * Dùng UPDATE…RETURNING trực tiếp (KHÔNG qua AlertsService.resolve(), vốn chỉ
 * cho phép chuyển từ status='acknowledged') vì alert 'new' chưa từng được ai
 * acknowledge cũng phải tự đóng được. Mirror
 * NoShowLifecycleService.reconcilePresence() (raw SQL UPDATE…RETURNING).
 */
@Injectable()
export class SecurityAlertAutoResolveService {
  private readonly logger = new Logger(SecurityAlertAutoResolveService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly securityAlertConfigService: SecurityAlertConfigService,
  ) {}

  async autoResolveExpired(): Promise<AutoResolveResult> {
    const timeoutMinutes =
      await this.securityAlertConfigService.getTimeoutMinutes();

    const result: unknown = await this.dataSource.manager.query(
      `UPDATE security_alerts
          SET status = 'resolved',
              resolved_at = NOW(),
              resolution_note = 'Tự động đóng do không tái phát trong ' || $1::int || ' phút'
        WHERE status <> 'resolved'
          AND COALESCE(last_seen_at, triggered_at) < NOW() - ($1::int * INTERVAL '1 minute')
          -- device_error: KHÔNG tự đóng khi còn camera trong alert vẫn offline (offline chỉ
          -- ghi 1 lần lúc chuyển trạng thái → last_seen_at không cập nhật). Đóng khi online lại.
          AND NOT (
            alert_type = 'device_error'
            AND EXISTS (
              SELECT 1 FROM iot_devices d
               WHERE d.status = 'offline'
                 AND (
                   d.id::text = payload_json->>'deviceId'
                   OR COALESCE(payload_json->'offlineDevices', '[]'::jsonb)
                      @> jsonb_build_array(jsonb_build_object('deviceId', d.id::text))
                 )
            )
          )
        RETURNING id`,
      [timeoutMinutes],
    );
    const n = this.rowsOf<IdRow>(result).length;
    return { scanned: n, resolved: n };
  }

  /** UPDATE…RETURNING qua TypeORM trả [rows,count]; SELECT/INSERT trả rows. */
  private rowsOf<T>(result: unknown): T[] {
    if (Array.isArray(result)) {
      const head: unknown = result[0];
      if (Array.isArray(head)) return head as T[];
      return result as T[];
    }
    return [];
  }
}

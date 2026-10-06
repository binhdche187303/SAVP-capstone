import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  StrangerAlertHook,
  StrangerAlertInput,
} from '../../../common/ports/stranger-alert-hook.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { ListStrangerAlertsQueryDto } from '../dto/list-stranger-alerts.query.dto.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';

interface StrangerRow {
  device_id: string;
  stranger_id: string | null;
  last_seen: Date | string;
  hit_count: number;
  room_id: string | null;
  similarity: string | null;
}

/**
 * StrangerAlertService (SAL-001 / #20) — cảnh báo khuôn mặt lạ + read-list admin.
 *
 * onStranger: throttle in-memory (gate ALERT, KHÔNG gate raw — raw đã lưu ở iot) →
 * rule (suppressed → dừng) → `AlertsService.recordAlert()` → WS room-scoped
 * (null-room-safe). NC-1 không deny. Metadata-only (KHÔNG base64). DATA-01 no migration.
 *
 * Thông báo (in-app/email theo `alert_rules.channels`, người nhận = quyền
 * security_alert.read: MANAGER + BA + SA) do `SecurityAlertNotifierService` gửi KHI
 * `recordAlert()` tạo alert MỚI — người lạ xuất hiện lại khi alert cũ còn mở chỉ bump,
 * KHÔNG gửi lại. Service này KHÔNG tự gửi notification/email (trước đây gửi riêng cho
 * SA/BA mỗi 5 phút/camera và email theo env STRANGER_ALERT_EMAIL_ENABLED).
 * `zoneId` = khu vực của thiết bị (iot_devices.zone_id) → mỗi khu vực 1 alert mở riêng;
 * thiết bị chưa gán khu vực → null (gộp toàn hệ thống như cũ).
 */
@Injectable()
export class StrangerAlertService implements StrangerAlertHook {
  private readonly logger = new Logger(StrangerAlertService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private static readonly DEFAULT_WINDOW_MINUTES = 1440;
  /** ⚠ in-memory: single-instance + reset khi restart (spec §3.1 FR-003). Chỉ giảm tải ghi DB. */
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
  ) {}

  async onStranger(evt: StrangerAlertInput): Promise<void> {
    // Throttle: 1 lần xử lý / device / window (KHÔNG gate raw — raw đã lưu ở iot).
    const throttleMs =
      this.configService.get<number>(
        'STRANGER_ALERT_THROTTLE_SECONDS',
        StrangerAlertService.DEFAULT_THROTTLE_SECONDS,
      ) * 1000;
    const now = Date.now();
    const last = this.lastAlertAt.get(evt.deviceId);
    if (last !== undefined && now - last < throttleMs) {
      return;
    }
    this.lastAlertAt.set(evt.deviceId, now);

    // Metadata-only payload (KHÔNG base64/snapshot).
    const meta = {
      deviceId: evt.deviceId,
      roomId: evt.roomId,
      strangerId: evt.strangerId,
      similarity: evt.similarity,
      capturedAt: evt.capturedAt.toISOString(),
    };

    // Khu vực của thiết bị → dedupe/rule theo khu vực (null = toàn hệ thống).
    const zoneId = await this.resolveDeviceZone(evt.deviceId);
    const { suppressed, rule } = await this.alertRulesService.findEffectiveRule(
      'stranger',
      zoneId,
    );
    if (suppressed) return; // AF1: rule tắt tường minh — dừng CẢ alert lẫn WS.

    try {
      // deviceCode/roomName để notifier dựng nội dung thông báo.
      const roomName = await this.resolveRoomName(evt.roomId);
      await this.alertsService.recordAlert({
        alertType: 'stranger',
        zoneId,
        ruleId: rule?.id ?? null,
        payloadJson: { ...meta, deviceCode: evt.deviceCode, roomName },
      });
    } catch (e) {
      // NotThrow riêng — lỗi ghi security_alerts KHÔNG được chặn WS.
      this.logger.error(
        `recordAlert failed (device=${evt.deviceId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }

    // WS room-scoped (null-room-safe).
    if (evt.roomId) {
      this.websocketService.emitToRoom(
        `room:${evt.roomId}`,
        'face.stranger.alert',
        meta,
      );
    }
  }

  private async resolveDeviceZone(deviceId: string): Promise<string | null> {
    try {
      const rows: { zone_id: string | null }[] =
        await this.dataSource.manager.query(
          `SELECT zone_id FROM iot_devices WHERE id = $1 LIMIT 1`,
          [deviceId],
        );
      return rows[0]?.zone_id ?? null;
    } catch {
      return null; // lỗi tra khu vực → fallback toàn hệ thống, KHÔNG chặn luồng cảnh báo.
    }
  }

  private async resolveRoomName(roomId: string | null): Promise<string | null> {
    if (!roomId) return null;
    const rows: { room_name: string | null }[] =
      await this.dataSource.manager.query(
        `SELECT room_name FROM rooms WHERE id = $1 LIMIT 1`,
        [roomId],
      );
    return rows[0]?.room_name ?? roomId;
  }

  async list(query: ListStrangerAlertsQueryDto): Promise<{
    data: Array<{
      deviceId: string;
      strangerId: string | null;
      roomId: string | null;
      similarity: string | null;
      lastSeen: Date | string;
      hitCount: number;
    }>;
    meta: { page: number; limit: number };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const window =
      query.windowMinutes ??
      this.configService.get<number>(
        'STRANGER_ALERT_WINDOW_MINUTES',
        StrangerAlertService.DEFAULT_WINDOW_MINUTES,
      );
    const offset = (page - 1) * limit;

    // SEC-02: KHÔNG select payload_json/raw_payload_sample → không lộ base64/snapshot.
    const rows: StrangerRow[] = await this.dataSource.manager.query(
      `SELECT e.device_id,
              e.payload_json->'extracted_fields'->>'stranger_id'  AS stranger_id,
              MAX(e.created_at)                                    AS last_seen,
              COUNT(*)::int                                        AS hit_count,
              (array_agg(e.room_id ORDER BY e.created_at DESC))[1] AS room_id,
              (array_agg(e.payload_json->'extracted_fields'->>'similarity'
                         ORDER BY e.created_at DESC))[1]           AS similarity
         FROM iot_device_events e
        WHERE e.event_type = 'face_stranger'
          AND e.created_at >= now() - ($1 * interval '1 minute')
        GROUP BY e.device_id, stranger_id
        ORDER BY last_seen DESC
        LIMIT $2 OFFSET $3`,
      [window, limit, offset],
    );

    return {
      data: rows.map((r) => ({
        deviceId: r.device_id,
        strangerId: r.stranger_id,
        roomId: r.room_id,
        similarity: r.similarity,
        lastSeen: r.last_seen,
        hitCount: Number(r.hit_count),
      })),
      meta: { page, limit },
    };
  }
}

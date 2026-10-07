import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { IoTDeviceEventEntity } from '../../iot/entities/iot-device-event.entity.js';
import { AlertRuleEntity } from './alert-rule.entity.js';

/**
 * SecurityAlertEntity (SAVP Security Alert Center scope — UC-121/123/124/129).
 *
 * Schema-only: KHÔNG logic nghiệp vụ (ghi alert, đánh giá rule, acknowledge/resolve
 * = UC-123 sau). KHÔNG soft-delete: đây là audit trail sự cố an ninh.
 *
 * - `status`: 'new' → 'acknowledged' → 'resolved' (UC-123 BR1: KHÔNG tự biến mất khỏi
 *   danh sách, chỉ đổi status khi người dùng chủ động xác nhận).
 * - Dedup "đang tiếp diễn" (UC-121 EX1: vượt ngưỡng liên tục = cập nhật `last_seen_at`/
 *   `occurrence_count` trên alert đang mở, KHÔNG tạo alert mới) LÀ UNIQUE PARTIAL
 *   (`UQ_security_alerts_open_*`, migration 20260722000007), KHÔNG PHẢI index tra cứu
 *   thường — pre-check ở tầng code luôn có cửa sổ race (2 event tụ tập gần như đồng
 *   thời cùng SELECT không thấy alert mở → cùng INSERT → nhân đôi). Chỉ unique index
 *   mới chặn được ở tầng DB. Tầng service PHẢI bắt lỗi 23505 (mirror
 *   `VehicleControlListService.isUniqueViolation`) và chuyển sang nhánh UPDATE
 *   `last_seen_at`/`occurrence_count` thay vì ném lỗi ra ngoài.
 * - `zone_id`/`alert_type` cũng tách 2 partial unique vì SQL coi NULL != NULL (mirror
 *   bẫy của `alert_rules`).
 * - `rule_id` trỏ rule nào kích hoạt (nullable — có alert không qua rule, vd đối chiếu
 *   control-list trực tiếp).
 * - `source_event_id` trỏ event thiết bị gốc làm bằng chứng (nullable).
 * - `payload_json` chứa bằng chứng linh hoạt: biển số, ảnh, số người đếm được,
 *   control_list_entry_id...
 *
 * ⚠ KIẾN TRÚC MỘT CHIỀU (đã chốt với Hải): entity/module này KHÔNG import ngược
 * face-access/anpr. Service ghi alert (sau này) nhận toàn bộ dữ liệu (plate, userId,
 * zoneId, payload...) qua THAM SỐ hàm từ module gọi, KHÔNG tự query module khác.
 */
@Entity('security_alerts')
export class SecurityAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'alert_type', type: 'varchar', length: 40 })
  alertType: string;

  @Column({ name: 'severity', type: 'varchar', length: 20, default: 'medium' })
  severity: string;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  /**
   * Khoá gộp thêm trong unique index "đang mở" (type, zone, dedupe_key). '' = gộp theo
   * (type, zone) như cũ; person_watchlist_match dùng userId → mỗi người 1 alert riêng.
   */
  @Column({ name: 'dedupe_key', type: 'varchar', length: 100, default: '' })
  dedupeKey: string;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'new' })
  status: string;

  @Column({ name: 'triggered_at', type: 'timestamptz' })
  triggeredAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'occurrence_count', type: 'integer', default: 1 })
  occurrenceCount: number;

  @Column({ name: 'source_event_id', type: 'uuid', nullable: true })
  sourceEventId: string | null;

  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  ruleId: string | null;

  @Column({ name: 'payload_json', type: 'jsonb', nullable: true })
  payloadJson: Record<string, unknown> | null;

  @Column({ name: 'acknowledged_by', type: 'uuid', nullable: true })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => ZoneEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone: ZoneEntity | null;

  @ManyToOne(() => IoTDeviceEventEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'source_event_id' })
  sourceEvent: IoTDeviceEventEntity | null;

  @ManyToOne(() => AlertRuleEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rule_id' })
  rule: AlertRuleEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'acknowledged_by' })
  acknowledgedByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by' })
  resolvedByUser: UserEntity | null;
}

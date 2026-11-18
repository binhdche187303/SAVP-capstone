import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';

/**
 * AlertRuleEntity (SAVP Security Alert Center scope — UC-122 Cấu hình quy tắc cảnh báo).
 *
 * Schema-only: KHÔNG logic nghiệp vụ (CRUD, validate ngưỡng, đánh giá rule = UC-122 sau).
 * - `zone_id` NULL = rule mặc định TOÀN KHUÔN VIÊN; có giá trị = rule riêng zone,
 *   OVERRIDE rule mặc định cho zone đó (SRS UC-122 BR2).
 * - `alert_type` + `zone_id` là cặp TRAP: SQL coi NULL != NULL nên
 *   `UNIQUE(alert_type, zone_id) WHERE deleted_at IS NULL` KHÔNG chặn được nhiều rule
 *   mặc định trùng loại. Migration 20260722000006 TÁCH 2 partial unique
 *   (zone_id IS NOT NULL / zone_id IS NULL) để chặn đúng cả 2 trường hợp.
 * - `enabled=false`: NGỪNG sinh cảnh báo nhưng event gốc vẫn ghi (UC-122 AF1/BR1) —
 *   tầng service đọc cờ này TRƯỚC khi ghi `security_alerts`, KHÔNG xóa rule.
 * - `restricted_hours_json` + `allowed_person_ids_json`: cấu hình cho UC-124 (xâm nhập
 *   khu vực hạn chế). `allowed_person_ids_json` là mảng user_id KHÔNG có FK (residual
 *   đã ghi trong báo cáo review — chấp nhận cho scope này, tách bảng nối sau nếu cần
 *   truy vấn ngược "user X được vào zone nào").
 * - Soft-delete (`deleted_at`) mirror pattern `vehicle_control_list`.
 */
@Entity('alert_rules')
export class AlertRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'alert_type', type: 'varchar', length: 40 })
  alertType: string;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'threshold', type: 'integer', nullable: true })
  threshold: number | null;

  @Column({ name: 'channels', type: 'jsonb', default: () => `'["in_app"]'` })
  channels: string[];

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'restricted_hours_json', type: 'jsonb', nullable: true })
  restrictedHoursJson: Record<string, unknown> | null;

  @Column({ name: 'allowed_person_ids_json', type: 'jsonb', nullable: true })
  allowedPersonIdsJson: string[] | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => ZoneEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone: ZoneEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  updatedByUser: UserEntity | null;
}

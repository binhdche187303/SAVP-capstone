import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { VisitChannel, VisitStatus } from '../constants/visit-status.constant.js';

const ts = { type: 'timestamptz' as const, nullable: true };

@Entity('visitor_visits')
export class VisitorVisitEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'visit_code', type: 'varchar', length: 16 }) visitCode: string;
  @Column({ name: 'visitor_id', type: 'uuid' }) visitorId: string;
  @Column({ type: 'varchar', length: 20 }) channel: VisitChannel;
  @Column({ type: 'varchar', length: 20 }) status: VisitStatus;
  @Column({ name: 'host_user_id', type: 'uuid' }) hostUserId: string;
  @Column({ name: 'department_id', type: 'uuid', nullable: true }) departmentId: string | null;
  @Column({ type: 'varchar', length: 120 }) purpose: string;
  @Column({ type: 'smallint', default: 0 }) companions: number;
  @Column({ name: 'plate_number', type: 'varchar', length: 16, nullable: true }) plateNumber: string | null;
  @Column({ name: 'scheduled_from', type: 'timestamptz' }) scheduledFrom: Date;
  @Column({ name: 'scheduled_to', type: 'timestamptz' }) scheduledTo: Date;
  @Column({ name: 'valid_from', type: 'timestamptz' }) validFrom: Date;
  @Column({ name: 'valid_to', type: 'timestamptz' }) validTo: Date;
  @Column({ name: 'check_in_at', ...ts }) checkInAt: Date | null;
  @Column({ name: 'check_out_at', ...ts }) checkOutAt: Date | null;
  @Column({ name: 'face_score', type: 'numeric', precision: 5, scale: 4, nullable: true }) faceScore: string | null;
  @Column({ name: 'reject_reason', type: 'text', nullable: true }) rejectReason: string | null;
  @Column({ name: 'revoked_at', ...ts }) revokedAt: Date | null;
  @Column({ name: 'manual_exit', type: 'boolean', default: false }) manualExit: boolean;
  @Column({ name: 'not_found', type: 'boolean', default: false }) notFound: boolean;
  @Column({ name: 'overstay_notified_at', ...ts }) overstayNotifiedAt: Date | null;
  @Column({ name: 'overstay_escalated_at', ...ts }) overstayEscalatedAt: Date | null;
  @Column({ name: 'last_seen_at', ...ts }) lastSeenAt: Date | null;
  @Column({ name: 'last_seen_zone_id', type: 'uuid', nullable: true }) lastSeenZoneId: string | null;
  @Column({ name: 'consent_at', ...ts }) consentAt: Date | null;
  @Column({ name: 'photo_file_id', type: 'uuid', nullable: true }) photoFileId: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy: string | null;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy: string | null;
  @Column({ name: 'approved_at', ...ts }) approvedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
}

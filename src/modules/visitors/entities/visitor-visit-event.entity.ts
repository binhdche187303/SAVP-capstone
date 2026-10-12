import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { VisitEventType } from '../constants/visit-status.constant.js';

@Entity('visitor_visit_events')
export class VisitorVisitEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'visit_id', type: 'uuid' }) visitId: string;
  @Column({ name: 'event_type', type: 'varchar', length: 30 }) eventType: VisitEventType;
  @Column({ name: 'event_time', type: 'timestamptz' }) eventTime: Date;
  @Column({ name: 'zone_id', type: 'uuid', nullable: true }) zoneId: string | null;
  @Column({ name: 'device_event_id', type: 'uuid', nullable: true }) deviceEventId: string | null;
  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true }) score: string | null;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId: string | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

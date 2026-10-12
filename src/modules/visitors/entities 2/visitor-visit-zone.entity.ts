import { Entity, PrimaryColumn } from 'typeorm';

@Entity('visitor_visit_zones')
export class VisitorVisitZoneEntity {
  @PrimaryColumn({ name: 'visit_id', type: 'uuid' }) visitId: string;
  @PrimaryColumn({ name: 'zone_id', type: 'uuid' }) zoneId: string;
}

import { Column, Entity, PrimaryColumn } from 'typeorm';

/** KPI-001 — khoảng giờ đã rollup đầy đủ `[covered_from, covered_until)` của từng rollup. */
@Entity('kpi_rollup_watermarks')
export class KpiRollupWatermarkEntity {
  @PrimaryColumn({ name: 'rollup_name', type: 'varchar', length: 50 })
  rollupName: string;

  @Column({ name: 'covered_from', type: 'timestamptz' })
  coveredFrom: Date;

  @Column({ name: 'covered_until', type: 'timestamptz' })
  coveredUntil: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}

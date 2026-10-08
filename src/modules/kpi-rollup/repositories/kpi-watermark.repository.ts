import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import type { RollupName } from '../kpi-rollup.constants.js';
import type { Watermark } from '../utils/kpi-window.types.js';

@Injectable()
export class KpiWatermarkRepository {
  constructor(private readonly dataSource: DataSource) {}

  async get(name: RollupName, runner?: QueryRunner): Promise<Watermark | null> {
    const rows = (await (runner ?? this.dataSource).query(
      `SELECT covered_from, covered_until FROM kpi_rollup_watermarks WHERE rollup_name = $1`,
      [name],
    )) as Array<{ covered_from: Date; covered_until: Date }>;
    if (!rows?.length) return null;
    return {
      coveredFrom: new Date(rows[0].covered_from),
      coveredUntil: new Date(rows[0].covered_until),
    };
  }

  async save(
    runner: QueryRunner,
    name: RollupName,
    wm: Watermark,
  ): Promise<void> {
    await runner.query(
      `INSERT INTO kpi_rollup_watermarks (rollup_name, covered_from, covered_until, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (rollup_name) DO UPDATE
         SET covered_from = EXCLUDED.covered_from,
             covered_until = EXCLUDED.covered_until,
             updated_at = now()`,
      [name, wm.coveredFrom, wm.coveredUntil],
    );
  }
}

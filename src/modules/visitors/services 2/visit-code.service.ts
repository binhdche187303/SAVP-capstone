import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

const VN_OFFSET_MS = 7 * 3_600_000;

/** Cấp mã lượt `VS-YYMMDD-NNNN` theo NGÀY VIỆT NAM của giờ hẹn; số thứ tự cấp nguyên tử bằng UPSERT có khóa dòng. */
@Injectable()
export class VisitCodeService {
  async next(manager: EntityManager, scheduledFrom: Date): Promise<string> {
    const vnDay = new Date(scheduledFrom.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
    const rows: Array<{ last_no: number }> = await manager.query(
      `INSERT INTO visitor_visit_code_counters (day, last_no) VALUES ($1::date, 1)
       ON CONFLICT (day) DO UPDATE SET last_no = visitor_visit_code_counters.last_no + 1
       RETURNING last_no`,
      [vnDay],
    );
    const yymmdd = vnDay.slice(2).replace(/-/g, '');
    return `VS-${yymmdd}-${String(rows[0].last_no).padStart(4, '0')}`;
  }
}

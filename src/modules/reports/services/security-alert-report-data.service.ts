import { filterValues, type FilterSelection } from '../../../common/utils/filter-selection.js';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityAlertEntity } from '../../alerts/entities/security-alert.entity.js';

export interface SecurityAlertExportParams {
  from: string;
  to: string;
  filters: {
    alertType: FilterSelection<string> | null;
    zoneId: FilterSelection<string> | null;
    status: FilterSelection<string> | null;
    severity?: FilterSelection<string> | null;
  };
}

export interface SecurityAlertExportRow {
  alertType: string;
  severity: string;
  zoneName: string;
  status: string;
  triggeredAt: Date;
  occurrenceCount: number;
  acknowledgedByName: string | null;
  acknowledgedAt: Date | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

export interface SecurityAlertStatusCounts {
  new: number;
  acknowledged: number;
  resolved: number;
}

const NO_ZONE_LABEL = 'Toàn khuôn viên';

/**
 * SecurityAlertReportDataService — tổng hợp dữ liệu cho UC-129.
 *
 * KHÔNG sửa/import logic của `AlertsService.list()` (phân trang, dùng cho UI) —
 * `listAllForExport` viết riêng, KHÔNG phân trang (§0.2 spec).
 *
 * §0.4 spec: dùng `leftJoinAndSelect` trên các relation đã khai sẵn của
 * `SecurityAlertEntity` (`zone`, `acknowledgedByUser`, `resolvedByUser`) —
 * KHÁC pattern raw-SQL của UC-127/128 vì entity này đã có relations tiện lợi.
 *
 * ⚠️ CRITICAL: `leftJoinAndSelect` KHÔNG tự lọc `zone.deleted_at IS NULL` —
 * PHẢI check thủ công ở `mapToExportRow` (mirror `AlertsService.findDetail()`),
 * nếu không sẽ lộ tên zone đã xóa mềm (vi phạm CLAUDE.md §5.5 quy tắc 1).
 */
@Injectable()
export class SecurityAlertReportDataService {
  constructor(
    @InjectRepository(SecurityAlertEntity)
    private readonly repo: Repository<SecurityAlertEntity>,
  ) {}

  async listAllForExport(
    params: SecurityAlertExportParams,
  ): Promise<SecurityAlertEntity[]> {
    const qb = this.repo
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.zone', 'zone')
      .leftJoinAndSelect('sa.acknowledgedByUser', 'ack')
      .leftJoinAndSelect('sa.resolvedByUser', 'res')
      .where('sa.triggeredAt BETWEEN :from AND :to', {
        from: params.from,
        to: params.to,
      })
      .orderBy('sa.triggeredAt', 'DESC');

    if (params.filters.alertType) {
      qb.andWhere('sa.alertType IN (:...alertType)', {
        alertType: filterValues(params.filters.alertType),
      });
    }
    if (params.filters.zoneId) {
      qb.andWhere('sa.zoneId IN (:...zoneId)', { zoneId: filterValues(params.filters.zoneId) });
    }
    if (params.filters.status) {
      qb.andWhere('sa.status IN (:...status)', { status: filterValues(params.filters.status).flatMap(value => value === 'open' ? ['new', 'acknowledged'] : [value]) });
    }

    if (params.filters.severity) qb.andWhere('sa.severity IN (:...severity)', { severity: filterValues(params.filters.severity) });
    return qb.getMany();
  }

  /** §3.7 FR-019 spec — map entity sang shape phẳng cho renderer. */
  mapToExportRow(alert: SecurityAlertEntity): SecurityAlertExportRow {
    const zoneName =
      alert.zone && !alert.zone.deletedAt ? alert.zone.zoneName : NO_ZONE_LABEL;

    return {
      alertType: alert.alertType,
      severity: alert.severity,
      zoneName,
      status: alert.status,
      triggeredAt: alert.triggeredAt,
      occurrenceCount: alert.occurrenceCount,
      acknowledgedByName: alert.acknowledgedByUser?.fullName ?? null,
      acknowledgedAt: alert.acknowledgedAt,
      resolvedByName: alert.resolvedByUser?.fullName ?? null,
      resolvedAt: alert.resolvedAt,
      resolutionNote: alert.resolutionNote,
    };
  }

  /** §5.6 CL-1 spec — COUNT thuần trên dữ liệu đã lọc, KHÔNG phải suy luận mới (BR1 SRS). */
  getStatusCounts(alerts: SecurityAlertEntity[]): SecurityAlertStatusCounts {
    const counts: SecurityAlertStatusCounts = {
      new: 0,
      acknowledged: 0,
      resolved: 0,
    };
    for (const alert of alerts) {
      if (alert.status === 'new') counts.new += 1;
      else if (alert.status === 'acknowledged') counts.acknowledged += 1;
      else if (alert.status === 'resolved') counts.resolved += 1;
    }
    return counts;
  }
}

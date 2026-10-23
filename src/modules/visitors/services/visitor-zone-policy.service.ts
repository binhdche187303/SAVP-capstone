import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VISITOR_PERMISSIONS } from '../constants/visitor-permission.constant.js';
import type { Actor } from './visit.service.js';

// Không import `err` từ visit.service: VisitService inject service này → tránh import vòng lúc nạp module.
const bad = (code: string, message: string) => new BadRequestException({ success: false, message, error: { code, details: {} } });

interface ZoneRow { id: string; zone_type: string; visitor_policy: string }

/**
 * Áp chính sách khu vực cho khách (`zones.visitor_policy`) lên danh sách khu được cấp của một lượt.
 * - Khu `open` luôn được cấp (không bỏ được); `restricted` chỉ người có `visitor.visit.manage` cấp được.
 * - Phải có ít nhất một cổng (nếu khuôn viên có cổng) — thiếu cổng thì camera cổng chặn khách ngay khi đến.
 */
@Injectable()
export class VisitorZonePolicyService {
  constructor(private readonly dataSource: DataSource) {}

  /** Khu cấp mặc định khi tạo lượt: mọi khu `open` + khu theo mã `visitor.default_zone_codes`. */
  async defaultZoneIds(defaultZoneCodes: string[]): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM zones WHERE deleted_at IS NULL AND status = 'active' AND (visitor_policy = 'open' OR zone_code = ANY($1))`,
      [defaultZoneCodes],
    );
    return rows.map((r) => r.id);
  }

  async resolve(zoneIds: string[] | undefined, actor: Actor | null): Promise<string[]> {
    const requested = [...new Set(zoneIds ?? [])];
    if (requested.length === 0) throw bad('VALIDATION_ERROR', 'Chọn ít nhất một khu vực được phép');
    if (!requested.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw bad('VALIDATION_ERROR', 'Có khu vực không tồn tại');

    const zones: ZoneRow[] = await this.dataSource.query(
      `SELECT id, zone_type, visitor_policy FROM zones WHERE deleted_at IS NULL AND status = 'active'`,
    );
    const byId = new Map(zones.map((z) => [z.id, z]));
    if (!requested.every((id) => byId.has(id))) throw bad('VALIDATION_ERROR', 'Có khu vực không tồn tại');

    const canManage = actor?.permissions.includes(VISITOR_PERMISSIONS.VISIT_MANAGE) ?? false;
    if (!canManage && requested.some((id) => byId.get(id)!.visitor_policy === 'restricted')) {
      throw bad('ZONE_RESTRICTED', 'Có khu vực hạn chế — chỉ quản lý khách / an ninh mới cấp được');
    }

    const result = new Set(requested);
    for (const z of zones) if (z.visitor_policy === 'open') result.add(z.id);

    const hasGate = zones.some((z) => z.zone_type === 'gate');
    if (hasGate && ![...result].some((id) => byId.get(id)!.zone_type === 'gate')) {
      throw bad('VALIDATION_ERROR', 'Chọn ít nhất một cổng khách được đi vào');
    }
    return [...result];
  }
}

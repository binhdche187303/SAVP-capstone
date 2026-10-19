import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpdateViolationRulesDto } from '../dto/update-violation-rules.dto.js';

const LATE_KEY = 'attendance.late_grace_minutes';
const EARLY_KEY = 'attendance.early_leave_threshold_minutes';

/**
 * Cấu hình vi phạm điểm danh cuộc họp (Lịch tuần UEL): hình thức, điểm trừ, điều kiện, mốc phút.
 * Điểm được chốt trên attendance_records bởi trigger fn_attendance_penalty lúc ghi nhận,
 * nên sửa cấu hình chỉ áp dụng cho các lần điểm danh sau.
 */
@Injectable()
export class ViolationRulesService {
  constructor(private readonly dataSource: DataSource) {}

  async getConfig(includeInactive: boolean) {
    const rules = await this.dataSource.query(
      `SELECT id, rule_code AS "ruleCode", rule_name AS "ruleName", penalty_points AS "penaltyPoints",
              condition_text AS "conditionText", is_system AS "isSystem", is_active AS "isActive",
              sort_order AS "sortOrder", updated_at AS "updatedAt"
         FROM attendance_violation_rules
        ${includeInactive ? '' : 'WHERE is_active = true'}
        ORDER BY sort_order, created_at`,
    );
    const cfg: Array<{ config_key: string; config_value: string }> =
      await this.dataSource.query(
        `SELECT config_key, config_value FROM system_configs WHERE config_key = ANY($1)`,
        [[LATE_KEY, EARLY_KEY]],
      );
    const num = (k: string, d: number) => {
      const v = Number(cfg.find((c) => c.config_key === k)?.config_value);
      return Number.isFinite(v) ? v : d;
    };
    return {
      rules,
      lateGraceMinutes: num(LATE_KEY, 5),
      earlyLeaveThresholdMinutes: num(EARLY_KEY, 15),
    };
  }

  async updateConfig(dto: UpdateViolationRulesDto, actorId: string) {
    await this.dataSource.transaction(async (m) => {
      const existing: Array<{ id: string; is_system: boolean }> = await m.query(
        `SELECT id, is_system FROM attendance_violation_rules`,
      );
      const byId = new Map(existing.map((r) => [r.id, r]));

      for (const id of dto.deleteIds ?? []) {
        const r = byId.get(id);
        if (!r) continue;
        if (r.is_system) {
          throw new BadRequestException({
            message: 'Không thể xoá hình thức vi phạm của hệ thống, chỉ có thể tắt',
            error: 'SYSTEM_RULE_UNDELETABLE',
          });
        }
        await m.query(`DELETE FROM attendance_violation_rules WHERE id = $1`, [id]);
      }

      for (const [i, r] of dto.rules.entries()) {
        const params = [
          r.ruleName.trim(),
          r.penaltyPoints,
          r.conditionText?.trim() || null,
          r.isActive,
          i + 1,
          actorId,
        ];
        if (r.id) {
          if (!byId.has(r.id)) {
            throw new BadRequestException({
              message: 'Hình thức vi phạm không tồn tại',
              error: 'RULE_NOT_FOUND',
            });
          }
          await m.query(
            `UPDATE attendance_violation_rules
                SET rule_name = $1, penalty_points = $2, condition_text = $3, is_active = $4,
                    sort_order = $5, updated_by = $6, updated_at = NOW()
              WHERE id = $7`,
            [...params, r.id],
          );
        } else {
          const code = `CUSTOM_${Date.now().toString(36).toUpperCase()}_${i}`;
          await m.query(
            `INSERT INTO attendance_violation_rules
               (rule_name, penalty_points, condition_text, is_active, sort_order, updated_by, rule_code, is_system)
             VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
            [...params, code],
          );
        }
      }

      for (const [key, val] of [
        [LATE_KEY, dto.lateGraceMinutes],
        [EARLY_KEY, dto.earlyLeaveThresholdMinutes],
      ] as const) {
        await m.query(
          `UPDATE system_configs SET config_value = $2, version_no = version_no + 1
            WHERE config_key = $1`,
          [key, String(val)],
        );
      }
    });
    return this.getConfig(true);
  }
}

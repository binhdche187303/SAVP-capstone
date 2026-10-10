import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  IsNull,
  Not,
  Between,
  type FindOptionsWhere,
} from 'typeorm';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { SecurityAlertConfigService } from './security-alert-config.service.js';
import { SecurityAlertNotifierService } from './security-alert-notifier.service.js';
import type { ZoneEntity } from '../../zones/entities/zone.entity.js';
import type {
  AlertSeverity,
  RecordAlertInput,
  RecordAlertResult,
} from '../dto/record-alert.input.js';
import type { QuerySecurityAlertsDto } from '../dto/query-security-alerts.dto.js';
import type { ResolveSecurityAlertDto } from '../dto/resolve-security-alert.dto.js';
import type { PaginationMeta } from '../types/pagination-meta.type.js';

/**
 * Trần số phần tử `payload_json.occurrences` giữ lại mỗi alert (mirror `loadHistory()`
 * limit 20) — tránh phình payload vô hạn khi 1 alert bị bump hàng trăm lần.
 */
const MAX_OCCURRENCES_PER_ALERT = 20;

/** ASC-001 §2.2: severity mặc định tĩnh theo alert_type khi caller KHÔNG truyền override. */
const DEFAULT_SEVERITY_BY_TYPE: Record<string, AlertSeverity> = {
  intrusion: 'critical',
  crowd: 'high',
  vehicle_control_match: 'medium',
  person_watchlist_match: 'medium',
  stranger: 'medium',
  unknown_vehicle: 'medium',
  device_error: 'low',
  // VIS-BE-001 (2.10 Khách đến làm việc)
  visitor_overstay: 'medium',
  visitor_must_leave: 'high',
  visitor_zone_violation: 'high',
};

export interface SecurityAlertDetail {
  alert: SecurityAlertEntity;
  zone: ZoneEntity | null;
  history: SecurityAlertEntity[];
}

const alertNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'SECURITY_ALERT_NOT_FOUND',
    message: 'Không tìm thấy cảnh báo an ninh',
  });

/**
 * AlertsService (ASC-001 / UC-123) — hạt nhân `recordAlert()` (điểm ghi DUY NHẤT vào
 * `security_alerts`, dùng chung cho 3d/UC-124/UC-125/UC-121 sau) + API Trung tâm cảnh
 * báo (list/detail/acknowledge/resolve/bulk).
 *
 * Dedup PHẢI qua unique partial index + bắt `23505` (race window UC-121 EX1 gốc) — index
 * vẫn là chốt chặn; tra alert mở trước chỉ để đường cộng dồn (phổ biến nhất) khỏi INSERT
 * hỏng. Acknowledge/resolve PHẢI qua conditional UPDATE (`WHERE status = 'x'`) +
 * kiểm `affected` (EX1 race giữa 2 người cùng xử lý).
 */
@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(SecurityAlertEntity)
    private readonly repo: Repository<SecurityAlertEntity>,
    private readonly securityAlertConfigService: SecurityAlertConfigService,
    @Optional()
    private readonly notifier?: SecurityAlertNotifierService,
  ) {}

  private resolveSeverity(
    alertType: string,
    override?: AlertSeverity,
  ): AlertSeverity {
    if (override) return override;
    return DEFAULT_SEVERITY_BY_TYPE[alertType] ?? 'medium';
  }

  /**
   * recordAlert (R1/R2 crux) — đã có alert đang mở cùng (alertType, zoneId, dedupeKey) →
   * UPDATE tăng occurrenceCount, GIỮ NGUYÊN severity/triggeredAt gốc (§2.3/§2.4); chưa có →
   * INSERT mới.
   *
   * Tra alert mở TRƯỚC (index unique partial): trước đây luôn INSERT trước → mỗi lần cộng
   * dồn (ca phổ biến nhất) = 1 INSERT hỏng (dòng ERROR 23505 trong log Postgres + dead
   * tuple) + SELECT + UPDATE + đọc lại. Race 2 lần gọi cùng lúc vẫn do unique index chặn:
   * INSERT hỏng 23505 → rơi về nhánh cũ bên dưới.
   */
  async recordAlert(input: RecordAlertInput): Promise<RecordAlertResult> {
    const zoneId = input.zoneId ?? null;
    const dedupeKey = input.dedupeKey ?? '';
    const severity = this.resolveSeverity(input.alertType, input.severity);
    const triggeredAt = input.triggeredAt ?? new Date();

    const existing = await this.findOpenAlert(
      input.alertType,
      zoneId,
      dedupeKey,
    );
    if (existing) {
      const reloaded = await this.bumpOccurrence(existing.id, input);
      return this.updatedAlert(reloaded);
    }

    const inserted = await this.tryInsert(input, zoneId, severity, triggeredAt);
    if (inserted) return this.newAlert(inserted);

    const open = await this.findOpenAlert(input.alertType, zoneId, dedupeKey);
    if (open) {
      const reloaded = await this.bumpOccurrence(open.id, input);
      return this.updatedAlert(reloaded);
    }

    // Race hiếm: 23505 báo có alert mở nhưng SELECT lại không thấy (vừa resolved giữa
    // 2 bước) — retry INSERT đúng 1 lần, KHÔNG lặp vô hạn.
    const retried = await this.tryInsert(input, zoneId, severity, triggeredAt);
    if (retried) return this.newAlert(retried);

    const openAfterRetry = await this.findOpenAlert(
      input.alertType,
      zoneId,
      dedupeKey,
    );
    if (openAfterRetry) {
      const reloaded = await this.bumpOccurrence(openAfterRetry.id, input);
      return this.updatedAlert(reloaded);
    }
    throw new Error(
      `recordAlert: không thể INSERT hoặc UPDATE alert (alertType=${input.alertType}, zoneId=${String(zoneId)}) sau 1 lần retry`,
    );
  }

  /**
   * Alert MỚI → thông báo (WS + kênh theo rule). Fire-and-forget: notifier tự NotThrow,
   * KHÔNG chặn luồng ghi alert (cron/ingestion). Bump (isNew=false) KHÔNG gọi — chống spam.
   */
  private newAlert(alert: SecurityAlertEntity): RecordAlertResult {
    void this.notifier?.notifyNewAlert(alert);
    return { alert, isNew: true };
  }

  /** Alert đang mở thêm lượt → WS cập nhật màn hình (dòng nổi lên đầu, "+1"). */
  private updatedAlert(alert: SecurityAlertEntity): RecordAlertResult {
    void this.notifier?.notifyUpdatedAlert(alert);
    return { alert, isNew: false };
  }

  private async tryInsert(
    input: RecordAlertInput,
    zoneId: string | null,
    severity: AlertSeverity,
    triggeredAt: Date,
  ): Promise<SecurityAlertEntity | null> {
    try {
      const entity = this.repo.create({
        alertType: input.alertType,
        severity,
        zoneId,
        dedupeKey: input.dedupeKey ?? '',
        status: 'new',
        triggeredAt,
        lastSeenAt: triggeredAt,
        occurrenceCount: 1,
        sourceEventId: input.sourceEventId ?? null,
        ruleId: input.ruleId ?? null,
        payloadJson: input.payloadJson ?? null,
      });
      return await this.repo.save(entity);
    } catch (e) {
      if (this.isUniqueViolation(e)) return null;
      throw e;
    }
  }

  /**
   * Đã có alert ĐANG MỞ cho (type, zone, dedupeKey)? — caller dùng để bỏ việc đắt chỉ cần
   * cho alert MỚI (VD crowd chụp ảnh camera, intrusion tra sự kiện gốc).
   */
  async hasOpenAlert(
    alertType: string,
    zoneId: string | null,
    dedupeKey = '',
  ): Promise<boolean> {
    return (await this.findOpenAlert(alertType, zoneId, dedupeKey)) !== null;
  }

  private async findOpenAlert(
    alertType: string,
    zoneId: string | null,
    dedupeKey: string,
  ): Promise<SecurityAlertEntity | null> {
    const where: FindOptionsWhere<SecurityAlertEntity> = {
      alertType,
      zoneId: zoneId ?? IsNull(),
      dedupeKey,
      status: Not('resolved'),
    };
    return this.repo.findOne({ where });
  }

  /**
   * bumpOccurrence (fix 2026-08-09, recon "nhiều người vi phạm cùng 1 alert") — trước đây
   * CHỈ update `last_seen_at`/`occurrence_count`, làm mất danh tính (`userId`/
   * `sourceEventId`) của MỌI lần vi phạm sau lần đầu (chỉ alert gốc từ `tryInsert()` giữ
   * được). Nay APPEND {userId, sourceEventId, occurredAt} của lần vi phạm hiện tại vào
   * `payload_json.occurrences` — top-level `source_event_id`/`payload_json` gốc của alert
   * VẪN giữ nguyên làm "đại diện" (ảnh chính hiển thị UI), `occurrences` chỉ bổ sung lịch
   * sử đầy đủ. Cắt còn `MAX_OCCURRENCES_PER_ALERT` phần tử gần nhất.
   *
   * PHẢI atomic trong 1 câu UPDATE (đọc + ghi `payload_json` của CHÍNH row đang bị khoá bởi
   * `WHERE id = $1`, giống hệt cách `occurrence_count = occurrence_count + 1` đã an toàn từ
   * trước) — KHÔNG SELECT rồi UPDATE riêng ở tầng JS, vì đó là race giữa 2 bump gần như
   * đồng thời (mất 1 entry). Áp dụng chung cho CẢ 5 alertType gọi `recordAlert()`
   * (intrusion/crowd/stranger/vehicle_control_match/person_watchlist_match) — cùng 1 bài
   * toán "mất dấu vết khi nhiều sự kiện bump vào 1 alert", không gate riêng theo loại.
   *
   * [FIX 2026-08-11] Chống thổi phồng `occurrences` khi CÙNG userId kích hoạt lặp lại
   * trong thời gian ngắn (vd camera bắn nhiều `appear` gần-trùng-giờ cho 1 lần đứng yên —
   * UC-124). `last_seen_at` VẪN tăng VÔ ĐIỀU KIỆN mỗi lần gọi (KHÔNG đổi dòng đó) — bắt
   * buộc để `SecurityAlertAutoResolveService` (dựa `COALESCE(last_seen_at, triggered_at)`)
   * không tự đóng nhầm alert trong lúc người/đám đông đó vẫn đang vi phạm liên tục (xem
   * recon R3 — phương án debounce ở tầng caller/skip hẳn `recordAlert()` bị loại vì đóng
   * băng `last_seen_at`).
   *
   * [FIX 2026-08-13] Root cause "occurrence_count=73 sau vài phút" (Crowd): trước đây
   * `occurrence_count` tăng VÔ ĐIỀU KIỆN mỗi lần gọi, KHÔNG qua debounce nào — vì
   * `alertType='crowd'` không gắn 1 người cụ thể (`payloadJson.userId` luôn null), điều
   * kiện debounce cũ (`elem->>'userId' = $2->>'userId'`) tự loại trừ hoàn toàn, không bao
   * giờ khớp. Trong khi đó Crowd bị bump ở tần suất RẤT cao: mỗi occupancy count-event từ
   * camera (`evaluateZoneCountNow()`, ~2-4s/lần khi còn vượt ngưỡng) CỘNG THÊM cron quét
   * lại đúng event đó 1 lần nữa (`evaluateCrowdAlerts()`, EVERY_MINUTE) — không có cờ
   * dedupe per-event nào giữa 2 đường, mỗi count-event bump 2 lần.
   *
   * Mở rộng ĐIỀU KIỆN MATCH của `latest_match`: khi `$5 = 'crowd'` → so khớp với entry CUỐI
   * CÙNG trong mảng `occurrences` BẤT KỂ userId (vì `userId` luôn null, không có gì để so).
   * CHỈ `alertType='crowd'` mới đi nhánh này — KHÔNG dùng "userId IS NULL" làm điều kiện
   * chung, vì Intrusion CŨNG có thể có `payloadJson.userId=null` (người lạ/chưa định danh —
   * xem `restricted-zone-intrusion.service.ts` `isViolation()`: "userId NULL → LUÔN vi
   * phạm") — nếu gate theo userId sẽ vô tình đổi luôn hành vi debounce của Intrusion cho ca
   * người lạ, ngoài phạm vi fix này. Intrusion (`userId` có giá trị HOẶC null) đi đúng
   * nhánh cũ 100% khi `$5 <> 'crowd'` — điều kiện match `occurrences` không đổi gì.
   *
   * `occurrence_count` CHỈ đưa vào khối debounce khi `alertType='crowd'` (`$5 = 'crowd' AND
   * is_debounced`) — KHÔNG dùng chung điều kiện trần với `occurrences` cho MỌI alertType.
   * Lý do: với Intrusion, `occurrences` VỐN ĐÃ được debounce theo userId từ fix 2026-08-11
   * (hành vi cũ, đã test), nhưng `occurrence_count` của Intrusion CHƯA TỪNG bị debounce —
   * nếu gate `occurrence_count` bằng ĐÚNG điều kiện debounce của `occurrences` (không phân
   * biệt alertType), ca "cùng userId vi phạm Intrusion lặp lại trong debounceSeconds" (đã
   * có test từ đêm trước, khẳng định `occurrence_count` vẫn tăng vô điều kiện) sẽ ĐỔI hành
   * vi ngoài ý muốn — vi phạm thẳng ràng buộc "Intrusion giữ nguyên 100%". Vì vậy
   * `occurrence_count` cố tình tách gate riêng theo `alertType`, `occurrences` giữ NGUYÊN
   * gate chung cũ (không đổi gì, kể cả cho Intrusion).
   *
   * `occurrenceDebounceSeconds=0` (min cấu hình) → điều kiện `ABS(...) < 0` không bao giờ
   * đúng → tắt debounce hoàn toàn cho Crowd, hành vi y hệt trước fix 2026-08-13.
   */
  private async bumpOccurrence(
    id: string,
    input: RecordAlertInput,
  ): Promise<SecurityAlertEntity> {
    const entry = {
      userId: (input.payloadJson?.userId as string | null | undefined) ?? null,
      sourceEventId: input.sourceEventId ?? null,
      occurredAt:
        (input.payloadJson?.occurredAt as string | undefined) ??
        new Date().toISOString(),
    };
    const debounceSeconds =
      await this.securityAlertConfigService.getDebounceSeconds();

    await this.repo.query(
      `WITH latest_match AS (
         SELECT (elem ->> 'occurredAt')::timestamptz AS occurred_at
         FROM security_alerts sa,
              jsonb_array_elements(
                COALESCE(sa.payload_json -> 'occurrences', '[]'::jsonb)
              ) WITH ORDINALITY AS t(elem, ord)
         WHERE sa.id = $1
           AND (
             ($2::jsonb ->> 'userId' IS NOT NULL AND elem ->> 'userId' = $2::jsonb ->> 'userId')
             OR $5 = 'crowd'
           )
         -- [FIX 2026-08-18] Crowd CHỈ: so "GẦN NHẤT VỀ THỜI GIAN" (nearest-match) thay vì
         -- "entry cuối cùng được GHI" (ord DESC — hành vi cũ, GIỮ NGUYÊN 100% cho mọi
         -- alertType khác qua nhánh ELSE (-ord) bên dưới). Lý do: Crowd có 2 đường gọi
         -- SONG SONG cùng ghi vào CÙNG 1 alert — evaluateZoneCountNow() (tức thời, mỗi
         -- webhook) VÀ evaluateCrowdAlerts() (cron EVERY_MINUTE, KHÔNG ORDER BY khi quét
         -- zone_presence_events) — cron có thể quét lại ĐÚNG event đã được đường tức thời
         -- xử lý, tới SAU nhưng KHÔNG THEO THỨ TỰ THỜI GIAN THẬT. "ord DESC" (so với entry
         -- ghi gần đây nhất theo THỨ TỰ XỬ LÝ) chỉ tương đương "gần nhất theo THỜI GIAN
         -- THẬT" khi xử lý tuần tự đúng thứ tự — giả định KHÔNG còn đúng khi cron xử lý lại
         -- ngoài thứ tự. occurredAt luôn là thời gian THẬT của event (event.eventTime/
         -- args.eventTime — KHÔNG PHẢI giờ xử lý, xem CrowdAlertService), nên so "gần nhất
         -- về occurredAt" làm debounce BẤT BIẾN với thứ tự/số lần xử lý lại: event X
         -- (occurredAt=T) dù bị đánh giá lại bao nhiêu lần, luôn so trùng khớp với chính
         -- entry@T đã ghi trước đó (diff=0) → debounce đúng, KHÔNG cần cơ chế đánh dấu
         -- per-event nào thêm. Non-crowd giữ đúng "ord DESC" qua ELSE (-ord)::double
         -- precision (ASC trên -ord = DESC trên ord) — 0% đổi hành vi Intrusion/stranger/
         -- vehicle_control_match/person_watchlist_match.
         ORDER BY (
           CASE
             WHEN $5 = 'crowd' THEN ABS(EXTRACT(EPOCH FROM (
               (elem ->> 'occurredAt')::timestamptz - ($2::jsonb ->> 'occurredAt')::timestamptz
             )))::double precision
             ELSE (-ord)::double precision
           END
         ) ASC
         LIMIT 1
       ),
       debounce_check AS (
         SELECT EXISTS (
           SELECT 1 FROM latest_match
           WHERE ABS(EXTRACT(EPOCH FROM (
             ($2::jsonb ->> 'occurredAt')::timestamptz - latest_match.occurred_at
           ))) < $4::numeric
         ) AS is_debounced
       )
       UPDATE security_alerts
          SET last_seen_at = NOW(),
              -- [FIX] bumpOccurrence() dùng raw SQL (this.repo.query), KHÔNG đi qua
              -- Repository.update()/save() nên @UpdateDateColumn của TypeORM KHÔNG tự
              -- update — updated_at bị đứng yên ở thời điểm INSERT vĩnh viễn dù alert vẫn
              -- tiếp tục nhận occurrence mới. FE (SecurityAlerts.jsx) đọc updated_at làm cột
              -- "Ngày"/"Giờ" chính (tooltip "Cập nhật gần nhất") nên hiện sai — luôn đứng ở
              -- lần đầu tiên thay vì lần gần nhất. Set tường minh ở đây để khớp đúng ý nghĩa
              -- cột, mirror hành vi acknowledge()/resolve() (đi qua repo.update() nên tự có).
              updated_at = NOW(),
              occurrence_count = CASE
                WHEN $5 = 'crowd' AND (SELECT is_debounced FROM debounce_check)
                THEN occurrence_count
                ELSE occurrence_count + 1
              END,
              payload_json = CASE
                WHEN (SELECT is_debounced FROM debounce_check)
                THEN payload_json
                ELSE jsonb_set(
                       COALESCE(payload_json, '{}'::jsonb),
                       '{occurrences}',
                       (
                         SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
                         FROM jsonb_array_elements(
                                COALESCE(payload_json -> 'occurrences', '[]'::jsonb)
                                || jsonb_build_array($2::jsonb)
                              ) WITH ORDINALITY AS t(elem, ord)
                         WHERE ord > GREATEST(
                           jsonb_array_length(
                             COALESCE(payload_json -> 'occurrences', '[]'::jsonb)
                             || jsonb_build_array($2::jsonb)
                           ) - $3,
                           0
                         )
                       ),
                       true
                     )
              END
        WHERE id = $1`,
      [
        id,
        JSON.stringify(entry),
        MAX_OCCURRENCES_PER_ALERT,
        debounceSeconds,
        input.alertType,
      ],
    );
    return this.getOrThrow(id);
  }

  async list(
    query: QuerySecurityAlertsDto,
  ): Promise<{ items: SecurityAlertEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<SecurityAlertEntity> = {};
    if (query.alertType) where.alertType = query.alertType;
    if (query.zoneId) where.zoneId = query.zoneId;
    // 'open' = chưa đóng (new + acknowledged) — ô "Đang mở" trên trang Cảnh báo.
    if (query.status === 'open') where.status = Not('resolved');
    else if (query.status) where.status = query.status;
    if (query.from && query.to) {
      where.triggeredAt = Between(new Date(query.from), new Date(query.to));
    }

    const sortBy = query.sortBy ?? 'lastSeenAt';
    const sortOrder = (query.sortOrder ?? 'desc').toUpperCase() as
      | 'ASC'
      | 'DESC';

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** R4 — detail: alert + zone (deleted_at IS NULL filter, §5.5 rule 1) + history (§2.6). */
  async findDetail(id: string): Promise<SecurityAlertDetail> {
    const alert = await this.repo.findOne({
      where: { id },
      relations: { zone: true, sourceEvent: true, rule: true },
    });
    if (!alert) throw alertNotFound();

    const zone = alert.zone && !alert.zone.deletedAt ? alert.zone : null;

    const history = await this.loadHistory(
      alert.alertType,
      alert.zoneId,
      alert.id,
    );

    return { alert, zone, history };
  }

  /** §2.6: cùng alertType + zoneId (IS NOT DISTINCT FROM cho case zoneId NULL), tối đa 20. */
  private async loadHistory(
    alertType: string,
    zoneId: string | null,
    excludeId: string,
  ): Promise<SecurityAlertEntity[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.alert_type = :alertType', { alertType })
      .andWhere('a.zone_id IS NOT DISTINCT FROM :zoneId', { zoneId })
      .andWhere('a.id != :excludeId', { excludeId })
      .orderBy('a.triggered_at', 'DESC')
      .limit(20)
      .getMany();
  }

  /** R5/R6 (crux EX1) — conditional UPDATE, KHÔNG select-rồi-update. */
  async acknowledge(
    id: string,
    actorUserId: string,
  ): Promise<SecurityAlertEntity> {
    const result = await this.repo.update(
      { id, status: 'new' },
      {
        status: 'acknowledged',
        acknowledgedBy: actorUserId,
        acknowledgedAt: new Date(),
      },
    );
    if (!result.affected) {
      throw this.alreadyProcessedConflict(await this.getOrThrow(id));
    }
    return this.getOrThrow(id);
  }

  /** R7/R8 — chỉ resolve được từ status='acknowledged'. */
  async resolve(
    id: string,
    dto: ResolveSecurityAlertDto,
    actorUserId: string,
  ): Promise<SecurityAlertEntity> {
    const result = await this.repo.update(
      { id, status: 'acknowledged' },
      {
        status: 'resolved',
        resolvedBy: actorUserId,
        resolvedAt: new Date(),
        resolutionNote: dto.resolutionNote,
      },
    );
    if (!result.affected) {
      throw this.alreadyProcessedConflict(await this.getOrThrow(id));
    }
    return this.getOrThrow(id);
  }

  /** R9 AF1 — xử lý từng id độc lập, 1 lỗi/conflict KHÔNG chặn id khác. */
  async bulkAcknowledge(
    ids: string[],
    actorUserId: string,
  ): Promise<{
    acknowledged: string[];
    alreadyProcessed: Array<{
      id: string;
      status: string;
      by: string | null;
      at: Date | null;
    }>;
  }> {
    const acknowledged: string[] = [];
    const alreadyProcessed: Array<{
      id: string;
      status: string;
      by: string | null;
      at: Date | null;
    }> = [];

    for (const id of ids) {
      try {
        await this.acknowledge(id, actorUserId);
        acknowledged.push(id);
      } catch (e) {
        if (e instanceof ConflictException) {
          const response = e.getResponse() as {
            status?: string;
            by?: string | null;
            at?: Date | null;
          };
          alreadyProcessed.push({
            id,
            status: response.status ?? 'unknown',
            by: response.by ?? null,
            at: response.at ?? null,
          });
        } else {
          throw e;
        }
      }
    }

    return { acknowledged, alreadyProcessed };
  }

  private async getOrThrow(id: string): Promise<SecurityAlertEntity> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw alertNotFound();
    return entity;
  }

  private alreadyProcessedConflict(
    current: SecurityAlertEntity,
  ): ConflictException {
    const by =
      current.status === 'resolved'
        ? current.resolvedBy
        : current.acknowledgedBy;
    const at =
      current.status === 'resolved'
        ? current.resolvedAt
        : current.acknowledgedAt;
    return new ConflictException({
      code: 'SECURITY_ALERT_ALREADY_PROCESSED',
      message: `Cảnh báo đã được xử lý (status=${current.status})`,
      status: current.status,
      by,
      at,
    });
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}

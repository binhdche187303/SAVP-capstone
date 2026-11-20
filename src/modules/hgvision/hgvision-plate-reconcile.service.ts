import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { VehicleControlListEntity } from '../anpr/entities/vehicle-control-list.entity.js';
import { VehicleRegistrationEntity } from '../anpr/entities/vehicle-registration.entity.js';
import {
  ControlListSyncHook,
  type PlateReconcileResult,
  type PlateReconciler,
} from '../anpr/services/control-list-sync.hook.js';
import { normalizePlate } from '../anpr/utils/normalize-plate.js';
import { AuditLogsService } from '../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../administration/entities/audit-log.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import { HgvisionClient, type HgvisionPlate } from './hgvision.client.js';
import {
  HgvisionPlateSyncService,
  expectedPlate,
  type ExpectedPlate,
} from './hgvision-plate-sync.service.js';

const PAGE_SIZE = 100;
/** Chặn vòng lặp phân trang (100 × 200 = 20.000 biển). Vượt → bỏ lượt, không kết luận thiếu. */
const MAX_PAGES = 200;
/** Ngưỡng an toàn: thiếu nhiều hơn mức này cùng lúc → nghi HGVision reset/lỗi, không tự đẩy. */
const MISSING_MAX_ABS = 20;
const MISSING_MIN_FOR_RATIO = 5;
const MISSING_MAX_RATIO = 0.5;
/** Nghỉ giữa các lần ghi để không dồn API HGVision. */
const WRITE_GAP_MS = 100;
/** Lượt đầu chạy sau khi BE khởi động (để HGVision client/DB sẵn sàng). */
const FIRST_RUN_DELAY_MS = 60_000;
/** Biển SAVP tạo luôn có ghi chú bắt đầu bằng tiền tố này (xem describe()). */
const SAVP_PREFIX = 'SAVP';

export const MSG_MISMATCH = 'Lệch với hệ thống nhận diện';
export const MSG_MISSING = 'Bị xoá bên hệ thống nhận diện';

interface PlateState {
  plate: string;
  live: VehicleControlListEntity[];
  reg: VehicleRegistrationEntity | null;
  owned: boolean;
  /** Trạng thái đồng bộ SAVP đang ghi (lấy của 1 dòng còn sống bất kỳ). */
  status: string | null;
}

/**
 * HgvisionPlateReconcileService — đối soát biển số SAVP ↔ HGVision (SAVP là gốc).
 *
 * Mỗi HGVISION_RECONCILE_INTERVAL_MS (mặc định 15 phút, 0 = tắt) + nút "Đối soát ngay":
 *  1. Đọc HẾT danh sách biển HGVision (phân trang). Lỗi giữa chừng → bỏ lượt.
 *  2. So với biển SAVP (chuẩn hoá qua normalizePlate):
 *     - SAVP có, HGVision mất (biển SAVP từng tạo) → tạo lại ("đã khôi phục lúc …").
 *       Thiếu quá ngưỡng → KHÔNG tự đẩy, đánh dấu `missing` + báo admin.
 *     - SAVP có, HGVision khác (bị sửa tay) → KHÔNG ghi đè, đánh dấu `mismatch`.
 *     - SAVP đồng bộ lỗi / chưa đồng bộ → đẩy lại.
 *     - SAVP không còn (xoá / tạm dừng) mà HGVision còn biển do SAVP tạo → xoá bên HGVision.
 *     - Biển HGVision không do SAVP tạo → không đụng.
 *  3. Cờ ghi tắt → chỉ đánh dấu, không ghi gì sang HGVision.
 * Đẩy/xoá đi qua HgvisionPlateSyncService.syncPlate (đọc lại DB ngay trước khi ghi →
 * xe vừa bị xoá trên SAVP không bị "hồi sinh").
 * Mỗi lượt khôi phục/xoá/lệch mới → audit log; có thay đổi → 1 thông báo gộp cho SYSTEM_ADMIN.
 */
@Injectable()
export class HgvisionPlateReconcileService
  implements PlateReconciler, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(HgvisionPlateReconcileService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
    @InjectRepository(VehicleControlListEntity)
    private readonly repo: Repository<VehicleControlListEntity>,
    @InjectRepository(VehicleRegistrationEntity)
    private readonly regRepo: Repository<VehicleRegistrationEntity>,
    private readonly sync: HgvisionPlateSyncService,
    private readonly hook: ControlListSyncHook,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAMERA_PROVIDER', 'ivss') !== 'hgvision') {
      return;
    }
    this.hook.registerReconciler(this);
    const intervalMs = Number(
      this.config.get('HGVISION_RECONCILE_INTERVAL_MS', 900_000),
    );
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.logger.log('Đối soát biển số HGVision tự động: TẮT (chỉ nút tay).');
      return;
    }
    this.firstRun = setTimeout(() => void this.reconcile(), FIRST_RUN_DELAY_MS);
    this.timer = setInterval(() => void this.reconcile(), intervalMs);
    this.logger.log(`Đối soát biển số HGVision mỗi ${intervalMs}ms.`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.timer = null;
    this.firstRun = null;
  }

  async reconcile(): Promise<PlateReconcileResult> {
    const writeEnabled = this.client.writeEnabled;
    const result: PlateReconcileResult = {
      enabled: true,
      busy: false,
      aborted: null,
      writeEnabled,
      checked: 0,
      restored: 0,
      removed: 0,
      pushed: 0,
      mismatched: 0,
      missing: 0,
      failed: 0,
    };
    if (this.running) return { ...result, busy: true };
    this.running = true;
    try {
      await this.run(result);
    } catch (e) {
      result.aborted = `Lỗi đối soát: ${e instanceof Error ? e.message : String(e)}`;
      this.logger.warn(result.aborted);
    } finally {
      this.running = false;
    }
    return result;
  }

  private async run(result: PlateReconcileResult): Promise<void> {
    // 1) Đọc hết HGVision. Lỗi → để ngoại lệ bay lên (bỏ lượt, không kết luận gì).
    const remote = await this.readAllRemote();
    if (!remote) {
      result.aborted = `HGVision có hơn ${PAGE_SIZE * MAX_PAGES} biển — bỏ lượt đối soát.`;
      this.logger.warn(result.aborted);
      return;
    }

    // 2) Trạng thái SAVP.
    const states = await this.loadStates();
    result.checked = states.length;

    const restore: PlateState[] = [];
    const push: PlateState[] = [];
    const remove: PlateState[] = [];
    const newMismatch: Array<{ s: PlateState; diff: string }> = [];
    const backInSync: PlateState[] = [];

    for (const s of states) {
      const want = expectedPlate(s.live, s.reg);
      const have = remote.get(s.plate);
      if (want) {
        if (!have) {
          // Biển SAVP từng tạo, trước đó coi là đã có → bị xoá bên HGVision.
          if (s.owned && isInSyncStatus(s.status)) restore.push(s);
          else push.push(s);
          continue;
        }
        if (!s.owned) continue; // Biển có sẵn của người khác — không đụng (syncPlate đã báo failed).
        if (!isInSyncStatus(s.status)) {
          // SAVP có thay đổi chưa đẩy được (lỗi / cờ tắt lúc đó) → đẩy lại, SAVP thắng.
          push.push(s);
          continue;
        }
        const diff = diffPlate(want, have);
        if (diff) {
          if (s.status !== 'mismatch') newMismatch.push({ s, diff });
          else result.mismatched++;
          await this.sync.mark(s.plate, 'mismatch', `${MSG_MISMATCH}: ${diff}`);
        } else if (s.status !== 'synced') {
          backInSync.push(s);
        }
        continue;
      }
      // SAVP không còn xe/biển active → HGVision chỉ nên giữ biển của người khác.
      if (have && s.owned && isSavpPlate(have)) remove.push(s);
    }

    result.mismatched += newMismatch.length;
    for (const s of backInSync) await this.sync.mark(s.plate, 'synced', null);

    // Ngưỡng an toàn: mất quá nhiều cùng lúc → không tự đẩy, chờ admin.
    const ownedPresent = states.filter(
      (s) => s.owned && expectedPlate(s.live, s.reg),
    ).length;
    const tooMany =
      restore.length > MISSING_MAX_ABS ||
      (restore.length >= MISSING_MIN_FOR_RATIO &&
        restore.length > ownedPresent * MISSING_MAX_RATIO);

    const restoredPlates: string[] = [];
    const removedPlates: string[] = [];
    if (!result.writeEnabled || tooMany) {
      for (const s of restore)
        await this.sync.mark(s.plate, 'missing', MSG_MISSING);
      result.missing = restore.length;
    } else {
      for (const s of restore) {
        const r = await this.write(s.plate);
        if (r === 'synced') {
          const note = `${MSG_MISSING}, đã khôi phục lúc ${formatVn(new Date())}`;
          await this.sync.mark(s.plate, 'synced', note);
          restoredPlates.push(s.plate);
        } else if (r === 'failed') result.failed++;
        // 'gone': xe vừa bị xoá trên SAVP trong lúc đối soát → không khôi phục.
      }
      result.restored = restoredPlates.length;
    }

    if (result.writeEnabled) {
      for (const s of push) {
        const r = await this.write(s.plate);
        if (r === 'synced') result.pushed++;
        else if (r === 'failed') result.failed++;
      }
      for (const s of remove) {
        const r = await this.write(s.plate);
        if (r === 'failed') result.failed++;
        else removedPlates.push(s.plate);
      }
      result.removed = removedPlates.length;
    }

    if (tooMany) {
      result.aborted = `HGVision thiếu ${restore.length} biển cùng lúc — không tự khôi phục, cần admin kiểm tra.`;
      this.logger.warn(result.aborted);
    }

    await this.report(result, {
      restoredPlates,
      removedPlates,
      newMismatch,
      // Chỉ báo biển MỚI bị thiếu — tránh lặp thông báo mỗi 15 phút.
      missingPlates:
        !result.writeEnabled || tooMany
          ? restore.filter((s) => s.status !== 'missing').map((s) => s.plate)
          : [],
      missingTotal: restore.length,
      tooMany,
    });
  }

  /**
   * Đẩy/xoá 1 biển qua luồng thường (syncPlate đọc lại DB trước khi ghi).
   * synced = HGVision đã đúng; gone = SAVP không còn dòng sống nào; failed = lỗi.
   */
  private async write(plate: string): Promise<'synced' | 'gone' | 'failed'> {
    await this.sync.syncPlate(plate);
    await sleep(WRITE_GAP_MS);
    const row =
      (await this.regRepo.findOne({
        where: { plateNumber: plate, deletedAt: IsNull() },
        select: { id: true, hgvisionSyncStatus: true },
      })) ??
      (await this.repo.findOne({
        where: { plateNumber: plate, deletedAt: IsNull() },
        select: { id: true, hgvisionSyncStatus: true },
      }));
    if (!row) return 'gone';
    return row.hgvisionSyncStatus === 'synced' ? 'synced' : 'failed';
  }

  /** Map biển chuẩn hoá → biển HGVision. null = quá MAX_PAGES (không kết luận được). */
  private async readAllRemote(): Promise<Map<string, HgvisionPlate> | null> {
    const map = new Map<string, HgvisionPlate>();
    let fetched = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.client.listPlates({ page, pageSize: PAGE_SIZE });
      const data = res?.data ?? [];
      fetched += data.length;
      for (const p of data) {
        const key = normalizePlate(p.license_plate);
        if (key) map.set(key, p);
      }
      // Dựa vào `total` (HGVision có thể giới hạn page_size nhỏ hơn PAGE_SIZE).
      const total = Number(res?.total ?? 0);
      if (fetched >= total) return map;
      if (data.length === 0) {
        throw new Error(
          `HGVision trả thiếu danh sách biển (${fetched}/${total}) — bỏ lượt.`,
        );
      }
    }
    return null;
  }

  /** Mọi biển SAVP liên quan: còn dòng sống, hoặc từng được SAVP đẩy (kể cả đã xoá mềm). */
  private async loadStates(): Promise<PlateState[]> {
    const live = await this.repo.find({ where: { deletedAt: IsNull() } });
    const regs = await this.regRepo.find({
      where: { deletedAt: IsNull() },
      relations: { user: true },
    });
    const ownedRows: Array<{ plate_number: string }> =
      await this.dataSource.manager.query(
        `SELECT plate_number FROM vehicle_control_list WHERE hgvision_synced_at IS NOT NULL
         UNION
         SELECT plate_number FROM vehicle_registrations WHERE hgvision_synced_at IS NOT NULL`,
      );
    const owned = new Set(ownedRows.map((r) => r.plate_number));

    const byPlate = new Map<string, PlateState>();
    const get = (plate: string): PlateState => {
      let s = byPlate.get(plate);
      if (!s) {
        s = {
          plate,
          live: [],
          reg: null,
          owned: owned.has(plate),
          status: null,
        };
        byPlate.set(plate, s);
      }
      return s;
    };
    for (const r of live) {
      const s = get(r.plateNumber);
      s.live.push(r);
      s.status ??= r.hgvisionSyncStatus ?? null;
    }
    for (const r of regs) {
      const s = get(r.plateNumber);
      s.reg = r;
      s.status ??= r.hgvisionSyncStatus ?? null;
    }
    for (const plate of owned) get(plate);
    return [...byPlate.values()];
  }

  private async report(
    result: PlateReconcileResult,
    d: {
      restoredPlates: string[];
      removedPlates: string[];
      newMismatch: Array<{ s: PlateState; diff: string }>;
      missingPlates: string[];
      missingTotal: number;
      tooMany: boolean;
    },
  ): Promise<void> {
    const log = (
      action: string,
      plate: string,
      extra: Record<string, unknown> = {},
    ) =>
      this.audit.logAction({
        actionType: action,
        entityType: 'hgvision_plate',
        severity: AuditLogSeverity.WARNING,
        metadataJson: { plateNumber: plate, ...extra },
      });
    for (const p of d.restoredPlates) await log('HGVISION_PLATE_RESTORED', p);
    for (const p of d.removedPlates)
      await log('HGVISION_PLATE_REMOVED_EXTRA', p);
    for (const m of d.newMismatch)
      await log('HGVISION_PLATE_MISMATCH', m.s.plate, { diff: m.diff });

    const lines: string[] = [];
    if (d.restoredPlates.length)
      lines.push(
        `Đã khôi phục ${d.restoredPlates.length} biển bị xoá bên HGVision: ${list(d.restoredPlates)}.`,
      );
    if (d.removedPlates.length)
      lines.push(
        `Đã xoá ${d.removedPlates.length} biển thừa bên HGVision: ${list(d.removedPlates)}.`,
      );
    if (d.newMismatch.length)
      lines.push(
        `${MSG_MISMATCH} (bị sửa tay bên HGVision): ${list(d.newMismatch.map((m) => m.s.plate))}.`,
      );
    if (d.tooMany && d.missingPlates.length)
      lines.push(
        `HGVision thiếu ${d.missingTotal} biển cùng lúc — không tự khôi phục. Kiểm tra HGVision rồi bấm "Đồng bộ HGVision".`,
      );
    else if (d.missingPlates.length)
      lines.push(`${MSG_MISSING} (cờ ghi đang tắt): ${list(d.missingPlates)}.`);
    if (!lines.length) return;

    try {
      const recipients = await this.systemAdmins();
      if (!recipients.length) return;
      await this.notifications.createNotification({
        notificationType: NotificationType.HGVISION_PLATE_RECONCILE,
        channel: NotificationChannel.IN_APP,
        subject: 'Đối soát biển số HGVision',
        content: lines.join(' '),
        priority: d.tooMany
          ? NotificationPriority.HIGH
          : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: { ...result },
      });
    } catch (e) {
      this.logger.warn(
        `Gửi thông báo đối soát lỗi: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async systemAdmins(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code = 'SYSTEM_ADMIN' AND u.deleted_at IS NULL`,
    );
    return rows.map((r) => r.id);
  }
}

/** SAVP coi là "đã có trên HGVision" — mất bên đó tức là bị xoá tay. */
function isInSyncStatus(status: string | null): boolean {
  return status === 'synced' || status === 'mismatch' || status === 'missing';
}

function isSavpPlate(p: HgvisionPlate): boolean {
  return String(p.lp_infor ?? '')
    .trim()
    .startsWith(SAVP_PREFIX);
}

/** Mô tả ngắn chỗ lệch; null = khớp. Trường HGVision không trả về → bỏ qua. */
export function diffPlate(
  want: ExpectedPlate,
  have: HgvisionPlate,
): string | null {
  const parts: string[] = [];
  if (have.is_blacklist !== undefined && have.is_blacklist !== null) {
    const black = have.is_blacklist === true || Number(have.is_blacklist) === 1;
    if (black !== want.isBlacklist)
      parts.push(
        black
          ? 'HGVision đang để danh sách đen'
          : 'HGVision đang để Bình thường',
      );
  }
  if (have.ident !== undefined && norm(have.ident) !== norm(want.ident))
    parts.push(`chủ xe "${String(have.ident ?? '').slice(0, 40)}"`);
  if (have.lp_infor !== undefined && norm(have.lp_infor) !== norm(want.lpInfor))
    parts.push('ghi chú khác');
  return parts.length ? parts.join(', ') : null;
}

function norm(v: unknown): string {
  return (typeof v === 'string' ? v : '').trim().replace(/\s+/g, ' ');
}

function list(plates: string[]): string {
  return plates.length > 10
    ? `${plates.slice(0, 10).join(', ')} và ${plates.length - 10} biển khác`
    : plates.join(', ');
}

function formatVn(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IVSS_EVENT_HANDLER } from '../../common/ports/ivss-event-hook.js';
import type { IvssEventHandlerPort } from '../../common/ports/ivss-event-hook.js';
import { VEHICLE_EVENT_HANDLER } from '../../common/ports/vehicle-event-hook.js';
import type { VehicleEventHandlerPort } from '../../common/ports/vehicle-event-hook.js';
import { HgvisionClient } from './hgvision.client.js';
import type { HgvisionHistoryObject } from './hgvision.client.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import {
  parseCameraChannelMap,
  toIvssFaceEvent,
  toVehicleEvent,
} from './hgvision-event.mapper.js';

interface ConfigRow {
  config_json: unknown;
}

/** Lùi cửa sổ poll để không lỡ sự kiện HGVision ghi trễ; trùng lặp lọc bằng object_id. */
const POLL_OVERLAP_SEC = 30;
/** Giữ object_id đã xử lý lâu hơn overlap một chút rồi mới quên. */
const SEEN_TTL_MS = (POLL_OVERLAP_SEC + 60) * 1000;
const PAGE_SIZE = 100;
/** Chặn vòng lặp phân trang khi backlog quá lớn (vd sau khi BE tắt lâu). */
const MAX_PAGES_PER_TICK = 20;

/**
 * HgvisionPollerService — HGVision không có webhook nên BE tự poll GET /api/history
 * mỗi HGVISION_POLL_INTERVAL_MS rồi chia sự kiện:
 * - khuôn mặt → IvssFaceEvent → IVSS_EVENT_HANDLER (cùng pipeline presence với IVSS bridge);
 * - biển số (lp_text) → VehicleEvent → VEHICLE_EVENT_HANDLER (cùng pipeline ANPR với webhook IVSS).
 *
 * Chỉ chạy khi CAMERA_PROVIDER=hgvision (mặc định 'ivss' ⇒ không làm gì).
 * Cursor giữ trong bộ nhớ: khởi động lại thì bắt đầu từ "bây giờ − overlap"
 * (không backfill lịch sử cũ); handler vẫn có dedupe riêng theo channel+person.
 */
@Injectable()
export class HgvisionPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HgvisionPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cursorSec = 0;
  private readonly seen = new Map<string, number>();

  constructor(
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
    @Inject(IVSS_EVENT_HANDLER) private readonly handler: IvssEventHandlerPort,
    @Inject(VEHICLE_EVENT_HANDLER)
    private readonly vehicleHandler: VehicleEventHandlerPort,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAMERA_PROVIDER', 'ivss') !== 'hgvision') {
      return;
    }
    const intervalMs = this.config.get<number>(
      'HGVISION_POLL_INTERVAL_MS',
      5000,
    );
    this.cursorSec = Math.floor(Date.now() / 1000) - POLL_OVERLAP_SEC;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(`HGVision poller bật (mỗi ${intervalMs}ms).`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Một lượt poll. Public để test; tick chồng nhau (HGVision chậm) thì bỏ lượt sau. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.pollOnce();
    } catch (e) {
      this.logger.warn(
        `HGVision poll lỗi: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async pollOnce(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const startTime = this.cursorSec;
    const cameraMap = await this.getCameraChannelMap();
    let maxTs = startTime;

    for (let page = 1; page <= MAX_PAGES_PER_TICK; page++) {
      const res = await this.client.searchHistory({
        startTime,
        endTime: nowSec,
        page,
        pageSize: PAGE_SIZE,
      });

      for (const obj of res.data ?? []) {
        const ts = obj.first_timestamp ?? obj.last_timestamp ?? 0;
        if (ts > maxTs) maxTs = ts;
        if (this.seen.has(obj.object_id)) continue;
        this.seen.set(obj.object_id, Date.now());

        const faceEvt = toIvssFaceEvent(obj, cameraMap);
        if (faceEvt) {
          await this.dispatch(obj, () => this.handler.onFaceEvent(faceEvt));
        }
        const vehicleEvt = toVehicleEvent(obj, cameraMap);
        if (vehicleEvt) {
          // Mặc định chỉ lưu đường dẫn ảnh (xem qua BE proxy) — tránh đầy ổ đĩa.
          vehicleEvt.remoteImagePath = obj.object_image_path || undefined;
          vehicleEvt.remotePlateImagePath = obj.lp_image_path || undefined;
          // Biển nằm trong control-list → tải ảnh về lưu làm bằng chứng (HGVision có thể xoá ảnh cũ).
          if (await this.isControlListed(vehicleEvt.plateNumber)) {
            vehicleEvt.imageBase64 = await this.loadVehicleImage(obj);
          }
          await this.dispatch(obj, () =>
            this.vehicleHandler.onVehicleEvent(vehicleEvt),
          );
        }
      }

      // Dùng page_size server THỰC trả về (server có thể tự giới hạn < PAGE_SIZE).
      const served = res.page_size || PAGE_SIZE;
      if (!res.data?.length || page * served >= (res.total ?? 0)) break;
    }

    // Tiến cursor nhưng luôn chừa overlap cho sự kiện ghi trễ.
    this.cursorSec = Math.max(
      startTime,
      Math.min(maxTs, nowSec) - POLL_OVERLAP_SEC,
    );
    this.evictSeen();
  }

  /**
   * Ảnh toàn cảnh xe (object_image_path), thiếu thì lấy ảnh cắt biển (lp_image_path).
   * Tải lỗi → bỏ ảnh, sự kiện vẫn được ghi.
   */
  private async loadVehicleImage(
    obj: HgvisionHistoryObject,
  ): Promise<string | undefined> {
    const path = obj.object_image_path || obj.lp_image_path;
    if (!path) return undefined;
    try {
      return await this.client.fetchImageBase64(path);
    } catch (e) {
      this.logger.warn(
        `HGVision tải ảnh ${obj.object_id} lỗi: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      return undefined;
    }
  }

  /** Biển đang active trong vehicle_control_list (blocklist/watchlist). Lỗi DB → coi như không. */
  private async isControlListed(plateNumber: string): Promise<boolean> {
    try {
      const rows: unknown[] = await this.dataSource.manager.query(
        `SELECT 1 FROM vehicle_control_list
         WHERE plate_number = $1 AND active = true AND deleted_at IS NULL LIMIT 1`,
        [plateNumber],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  /** Handler lỗi không làm dừng lượt poll. SEC-01: chỉ log metadata. */
  private async dispatch(
    obj: HgvisionHistoryObject,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (e) {
      this.logger.warn(
        `HGVision event ${obj.object_id} xử lý lỗi (camera=${obj.camera_id}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  private evictSeen(): void {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [id, at] of this.seen) {
      if (at < cutoff) this.seen.delete(id);
    }
  }

  private async getCameraChannelMap(): Promise<Record<string, number>> {
    const rows: ConfigRow[] = await this.dataSource.manager.query(
      `SELECT config_json FROM system_configs
       WHERE config_key = 'hgvision.camera_channel_map' AND is_active = true LIMIT 1`,
    );
    return parseCameraChannelMap(rows[0]?.config_json);
  }
}

import { Injectable, Logger } from '@nestjs/common';

/** Bên nhận thay đổi danh sách kiểm soát (vd HGVision). Tự ghi trạng thái đồng bộ vào DB. */
export interface ControlListSyncHandler {
  syncPlate(plateNumber: string): Promise<void>;
}

/** Kết quả 1 lượt đối soát biển số SAVP ↔ HGVision. */
export interface PlateReconcileResult {
  /** false = chưa dùng HGVision (CAMERA_PROVIDER khác hgvision). */
  enabled: boolean;
  /** true = đang có lượt khác chạy → lượt này không làm gì. */
  busy: boolean;
  /** Lý do bỏ lượt (đọc HGVision lỗi / thiếu quá nhiều biển). null = chạy trọn. */
  aborted: string | null;
  writeEnabled: boolean;
  /** Số biển SAVP đã so. */
  checked: number;
  /** Bị xoá bên HGVision → đã tạo lại. */
  restored: number;
  /** Xe đã xoá/tạm dừng trên SAVP mà HGVision còn → đã xoá bên HGVision. */
  removed: number;
  /** Đồng bộ lỗi/chưa đồng bộ → đã đẩy lại. */
  pushed: number;
  /** Bị sửa tay bên HGVision → chỉ báo lệch (không ghi đè). */
  mismatched: number;
  /** Bị xoá bên HGVision nhưng chưa khôi phục (cờ ghi tắt / vượt ngưỡng). */
  missing: number;
  /** Đẩy/xoá lỗi trong lượt này. */
  failed: number;
}

export interface PlateReconciler {
  reconcile(): Promise<PlateReconcileResult>;
}

/**
 * ControlListSyncHook — móc để module khác nhận thay đổi biển số kiểm soát.
 * HgvisionModule đã import AnprModule nên ANPR không inject ngược HGVision được (vòng);
 * thay vào đó HGVision tự `register()` lúc khởi động. Chưa ai đăng ký → không làm gì.
 * Lỗi của bên nhận KHÔNG làm hỏng thao tác lưu ở SAVP.
 */
@Injectable()
export class ControlListSyncHook {
  private readonly logger = new Logger(ControlListSyncHook.name);
  private handler?: ControlListSyncHandler;
  private reconciler?: PlateReconciler;

  register(handler: ControlListSyncHandler): void {
    this.handler = handler;
  }

  registerReconciler(reconciler: PlateReconciler): void {
    this.reconciler = reconciler;
  }

  /** Đối soát ngay (nút admin). Chưa dùng HGVision → enabled=false. */
  async reconcile(): Promise<PlateReconcileResult> {
    if (!this.reconciler) {
      return {
        enabled: false,
        busy: false,
        aborted: null,
        writeEnabled: false,
        checked: 0,
        restored: 0,
        removed: 0,
        pushed: 0,
        mismatched: 0,
        missing: 0,
        failed: 0,
      };
    }
    return this.reconciler.reconcile();
  }

  get enabled(): boolean {
    return !!this.handler;
  }

  async notify(plateNumber: string): Promise<void> {
    if (!this.handler || !plateNumber) return;
    try {
      await this.handler.syncPlate(plateNumber);
    } catch (e) {
      this.logger.warn(
        `Đồng bộ biển ${plateNumber} lỗi: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

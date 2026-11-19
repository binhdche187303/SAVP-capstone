import { Injectable, Logger } from '@nestjs/common';

/** Bên nhận thay đổi danh sách kiểm soát (vd HGVision). Tự ghi trạng thái đồng bộ vào DB. */
export interface ControlListSyncHandler {
  syncPlate(plateNumber: string): Promise<void>;
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

  register(handler: ControlListSyncHandler): void {
    this.handler = handler;
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

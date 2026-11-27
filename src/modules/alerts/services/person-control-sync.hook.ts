import { Injectable, Logger } from '@nestjs/common';

/** Bên nhận thay đổi danh sách người giám sát (vd HGVision). Tự ghi trạng thái vào DB. */
export interface PersonControlSyncHandler {
  syncPersonControl(entryId: string): Promise<void>;
}

/**
 * PersonControlSyncHook — mirror `ControlListSyncHook` (biển số). AlertsModule KHÔNG được
 * import HgvisionModule (ràng buộc một chiều) → HGVision tự `register()` lúc khởi động.
 * Chưa ai đăng ký → không làm gì. Chạy nền: lỗi bên nhận KHÔNG làm hỏng thao tác lưu.
 */
@Injectable()
export class PersonControlSyncHook {
  private readonly logger = new Logger(PersonControlSyncHook.name);
  private handler?: PersonControlSyncHandler;

  register(handler: PersonControlSyncHandler): void {
    this.handler = handler;
  }

  get enabled(): boolean {
    return !!this.handler;
  }

  /** Fire-and-forget: đăng ký ảnh lên HGVision có thể mất vài giây. */
  notify(entryId: string): void {
    if (!this.handler || !entryId) return;
    this.handler
      .syncPersonControl(entryId)
      .catch((e: unknown) =>
        this.logger.warn(
          `Đồng bộ người giám sát ${entryId} sang HGVision lỗi: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }
}

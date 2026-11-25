import { Injectable, Logger } from '@nestjs/common';

/** Một khuôn mặt khớp trong kho định danh (HGVision). */
export interface FaceIdentMatch {
  faceIdent: string;
  score: number;
}

/** Kết quả kiểm tra 1 ảnh đăng ký ở server (lớp 2 + 3). */
export interface FaceImageInspection {
  /** Số khuôn mặt tìm thấy trong ảnh (phải đúng 1). */
  faceCount: number;

  /** Các định danh đã có khớp với khuôn mặt trong ảnh, điểm giảm dần. */
  matches: FaceIdentMatch[];
}

export interface FaceImageChecker {
  inspect(image: Buffer, mimeType: string): Promise<FaceImageInspection>;

  /** face_ident của 1 user trên kho định danh (để bỏ qua khớp với chính mình). */
  faceIdentOf(userId: string): Promise<string | null>;
}

export interface FaceEnrollmentSyncHandler {
  /** Đưa kho định danh về đúng hồ sơ active hiện tại của user (đăng ký / thay / gỡ). */
  syncUser(userId: string): Promise<void>;
}

/**
 * FaceEnrollmentHook — móc để HgvisionModule kiểm tra ảnh + đồng bộ khuôn mặt.
 *
 * HgvisionModule → IvssModule → AccountsModule, nên Accounts không inject ngược HGVision
 * được (repo cấm forwardRef). HGVision tự `register…()` lúc khởi động; chưa ai đăng ký
 * (CAMERA_PROVIDER khác hgvision) → `checker` null, `notifyChanged` không làm gì.
 * Lỗi đồng bộ KHÔNG làm hỏng thao tác lưu ở SAVP — cron đối soát bên HGVision sẽ thử lại.
 */
@Injectable()
export class FaceEnrollmentHook {
  private readonly logger = new Logger(FaceEnrollmentHook.name);
  private checker?: FaceImageChecker;
  private handler?: FaceEnrollmentSyncHandler;
  registerChecker(checker: FaceImageChecker): void {
    this.checker = checker;
  }

  registerSync(handler: FaceEnrollmentSyncHandler): void {
    this.handler = handler;
  }

  get imageChecker(): FaceImageChecker | null {
    return this.checker ?? null;
  }

  async notifyChanged(userId: string): Promise<void> {
    if (!this.handler || !userId) return;
    try {
      await this.handler.syncUser(userId);
    } catch (e) {
      this.logger.warn(
        `Đồng bộ khuôn mặt user ${userId} lỗi: ${e instanceof Error ? e.message : String(e)} — cron sẽ thử lại.`,
      );
    }
  }
}

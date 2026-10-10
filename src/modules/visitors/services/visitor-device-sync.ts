import { Injectable } from '@nestjs/common';

/**
 * Đồng bộ khuôn mặt của một lượt xuống thiết bị (IVSS thường trực, FaceGate theo khu vực).
 * `VisitService` gọi sau MỌI thao tác đổi quyền ra vào; bản thật ở Task 9 (IVSS) và Task 11 (FaceGate).
 * Cài đặt PHẢI không ném lỗi: thiết bị hỏng không được làm hỏng thao tác nghiệp vụ.
 */
export abstract class VisitorDeviceSync {
  abstract syncVisit(visitId: string): Promise<void>;
}

@Injectable()
export class NoopVisitorDeviceSync extends VisitorDeviceSync {
  async syncVisit(): Promise<void> {
    // Chưa có thiết bị nào được cấu hình.
  }
}

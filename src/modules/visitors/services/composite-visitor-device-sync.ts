import { Injectable } from '@nestjs/common';
import { VisitorDeviceSync } from './visitor-device-sync.js';
import { VisitorFaceGateService } from './visitor-facegate.service.js';
import { VisitorFaceLifecycleService } from './visitor-face-lifecycle.service.js';

/** IVSS trước (hồ sơ `face_profiles` là nguồn ảnh), FaceGate sau. Mỗi bên tự nuốt lỗi của mình. */
@Injectable()
export class CompositeVisitorDeviceSync extends VisitorDeviceSync {
  constructor(
    private readonly lifecycle: VisitorFaceLifecycleService,
    private readonly faceGate: VisitorFaceGateService,
  ) {
    super();
  }

  async syncVisit(visitId: string): Promise<void> {
    await this.lifecycle.syncVisit(visitId);
    await this.faceGate.syncVisit(visitId);
  }
}

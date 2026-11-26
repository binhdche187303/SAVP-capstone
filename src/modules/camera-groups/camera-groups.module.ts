import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HgvisionModule } from '../hgvision/hgvision.module.js';
import { CameraGroupHgSyncService } from './services/camera-group-hg-sync.service.js';
import { CameraGroupsController } from './controllers/camera-groups.controller.js';
import { CameraGroupsService } from './services/camera-groups.service.js';

/** CAMG-001 (Kế hoạch #12) — nhóm camera. Schema ở migration 20261014000001; truy vấn SQL thuần. */
@Module({
  imports: [AuthModule, HgvisionModule],
  controllers: [CameraGroupsController],
  providers: [CameraGroupsService, CameraGroupHgSyncService],
})
export class CameraGroupsModule {}

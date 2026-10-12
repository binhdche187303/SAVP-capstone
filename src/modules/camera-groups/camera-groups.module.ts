import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CameraGroupsController } from './controllers/camera-groups.controller.js';
import { CameraGroupsService } from './services/camera-groups.service.js';

/** CAMG-001 (Kế hoạch #12) — nhóm camera. Schema ở migration 20261014000001; truy vấn SQL thuần. */
@Module({
  imports: [AuthModule],
  controllers: [CameraGroupsController],
  providers: [CameraGroupsService],
})
export class CameraGroupsModule {}

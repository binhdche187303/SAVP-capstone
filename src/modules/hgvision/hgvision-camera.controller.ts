import {
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { HgvisionCameraService } from './hgvision-camera.service.js';

export const HGVISION_CAMERA_READ = 'hgvision.camera.read';
export const HGVISION_SYSTEM_READ = 'hgvision.system.read';

/**
 * Camera HGVision cho FE: danh sách + tình trạng, nhật ký, nhóm, tài nguyên máy chủ và
 * proxy live HLS (FE không gọi thẳng :8113, không thấy client secret hay tài khoản camera).
 * Bảo vệ xem được TẤT CẢ camera (đã chốt).
 */
@ApiTags('HGVision - Camera')
@Controller('hgvision')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HgvisionCameraController {
  constructor(private readonly cameras: HgvisionCameraService) {}

  @Get('status')
  @RequirePermissions(HGVISION_SYSTEM_READ)
  @ApiOperation({
    summary: 'Kiểm tra kết nối HGVision (cấu hình, token, scope)',
  })
  async status() {
    return {
      success: true,
      message: 'HGVision status',
      data: await this.cameras.status(),
    };
  }

  @Get('cameras')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({
    summary: 'Danh sách camera kèm tình trạng kết nối và link live',
  })
  async list() {
    const data = await this.cameras.listCameras();
    return {
      success: true,
      message: 'Cameras retrieved successfully',
      data,
      meta: {
        total: data.length,
        online: data.filter((c) => c.status === 'online').length,
      },
    };
  }

  @Get('cameras/:name/health')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Tình trạng 1 camera (kèm lịch sử 1 giờ)' })
  async health(@Param('name') name: string) {
    return {
      success: true,
      message: 'Camera health',
      data: await this.cameras.cameraHealth(name),
    };
  }

  @Get('cameras/:name/logs')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Nhật ký kết nối của 1 camera' })
  async logs(
    @Param('name') name: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('beforeId', new DefaultValuePipe(0), ParseIntPipe) beforeId: number,
    @Query('level') level?: string,
  ) {
    const data = await this.cameras.cameraLogs(name, {
      limit: Math.min(Math.max(limit, 1), 200),
      beforeId: beforeId || undefined,
      level: level || undefined,
    });
    return { success: true, message: 'Camera logs', data };
  }

  @Get('groups')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Nhóm camera (khu vực)' })
  async groups() {
    return {
      success: true,
      message: 'Camera groups',
      data: await this.cameras.groups(),
    };
  }

  @Get('resources')
  @RequirePermissions(HGVISION_SYSTEM_READ)
  @ApiOperation({ summary: 'Tài nguyên máy chủ HGVision (CPU/RAM/ổ đĩa/GPU)' })
  async resources() {
    return {
      success: true,
      message: 'Server resources',
      data: await this.cameras.resources(),
    };
  }

  @Get('live/:name/index.m3u8')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Playlist live HLS của camera (qua proxy BE)' })
  async live(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const body = await this.cameras.livePlaylist(name);
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      })
      .send(body);
  }

  @Get('stream')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Proxy segment/playlist HLS của HGVision' })
  async stream(
    @Query('path') path: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.cameras.media(path ?? '', range);
    res
      .status(out.status)
      .set({ ...out.headers, 'Content-Type': out.contentType })
      .send(out.body);
  }
}

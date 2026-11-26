import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { HgvisionCameraService } from './hgvision-camera.service.js';
import { HgvisionSnapshotService } from './hgvision-snapshot.service.js';
import { CreateHgCameraDto } from './dto/create-hg-camera.dto.js';
import { ImportHgCamerasDto } from './dto/import-hg-cameras.dto.js';
import { HgvisionCameraImportService } from './hgvision-camera-import.service.js';

export const HGVISION_CAMERA_READ = 'hgvision.camera.read';
export const HGVISION_SYSTEM_READ = 'hgvision.system.read';
export const HGVISION_CAMERA_WRITE = 'hgvision.camera.write';

const requireCamera = (camera: string | undefined): string => {
  const v = (camera ?? '').trim();
  if (!v) throw new BadRequestException('Thiếu tên camera');
  return v;
};

/**
 * Camera HGVision cho FE: danh sách + tình trạng, nhật ký, nhóm, tài nguyên máy chủ và
 * proxy live HLS (FE không gọi thẳng :8113, không thấy client secret hay tài khoản camera).
 * Bảo vệ xem được TẤT CẢ camera (đã chốt).
 */
@ApiTags('HGVision - Camera')
@Controller('hgvision')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HgvisionCameraController {
  constructor(
    private readonly cameras: HgvisionCameraService,
    private readonly snapshots: HgvisionSnapshotService,
    private readonly importer: HgvisionCameraImportService,
  ) {}

  @Post('cameras')
  @RequirePermissions(HGVISION_CAMERA_WRITE)
  @ApiOperation({
    summary: 'Thêm camera RTSP sang HGVision (cần scope cameras:write)',
  })
  async createCamera(@Body() dto: CreateHgCameraDto) {
    return {
      success: true,
      message: 'Đã thêm camera sang HGVision',
      data: await this.cameras.createCamera(dto),
    };
  }

  @Post('cameras/import')
  @RequirePermissions(HGVISION_CAMERA_WRITE)
  @ApiOperation({
    summary:
      'Import camera từ Excel (dryRun = xem trước): tạo/cập nhật thiết bị SAVP theo khu vực, tuỳ chọn thêm sang HGVision',
  })
  async importCameras(@Body() dto: ImportHgCamerasDto) {
    return {
      success: true,
      message: dto.dryRun === false ? 'Đã import camera' : 'Xem trước import',
      data: await this.importer.import(dto),
    };
  }

  @Post('cameras/:name/snapshot')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({
    summary:
      'Chụp ảnh màn hình camera (BE lấy 1 khung hình từ luồng live, lưu lịch sử)',
  })
  async snapshot(
    @Param('name') name: string,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    return {
      success: true,
      data: await this.snapshots.capture(name, user?.userId ?? null),
    };
  }

  @Get('snapshots')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({
    summary: 'Lịch sử ảnh chụp camera (mới nhất trước), lọc theo tên camera',
  })
  async listSnapshots(
    @Query('camera') camera: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return {
      success: true,
      data: await this.snapshots.list({ camera, limit }),
    };
  }

  @Get('snapshots/:id/file')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Tải file ảnh chụp camera (PNG)' })
  async snapshotFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.snapshots.file(id);
    res.status(200).set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${f.fileName}"`,
      'Cache-Control': 'private, max-age=300',
      ...(f.sizeBytes ? { 'Content-Length': String(f.sizeBytes) } : {}),
    });
    f.stream.pipe(res);
  }

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

  @Get('playback/recordings')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({
    summary:
      'Xem lại: các khoảng có ghi hình + đoạn ghi của 1 camera (from/to epoch ms, tối đa 24 giờ)',
  })
  async playbackRecordings(
    @Query('camera') camera: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return {
      success: true,
      message: 'Playback recordings',
      data: await this.cameras.playbackRecordings(
        requireCamera(camera),
        Number(from),
        Number(to),
      ),
    };
  }

  @Get('playback/playlist.m3u8')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Xem lại: playlist HLS trong khoảng thời gian' })
  async playbackPlaylist(
    @Query('camera') camera: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ): Promise<void> {
    const body = await this.cameras.playbackPlaylist(
      requireCamera(camera),
      Number(from),
      Number(to),
    );
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      })
      .send(body);
  }

  @Get('playback/download')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({
    summary: 'Xem lại: tải MP4 trong khoảng thời gian (tối đa 1 giờ)',
  })
  async playbackDownload(
    @Query('camera') camera: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.cameras.playbackDownload(
      requireCamera(camera),
      Number(from),
      Number(to),
    );
    res.status(200).set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${f.fileName}"`,
      'Cache-Control': 'private, no-store',
      ...(f.contentLength ? { 'Content-Length': f.contentLength } : {}),
    });
    const stream = Readable.fromWeb(f.body as NodeReadableStream);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  @Get('stream')
  @RequirePermissions(HGVISION_CAMERA_READ)
  @ApiOperation({ summary: 'Proxy segment/playlist HLS của HGVision' })
  async stream(
    @Query('path') path: string,
    @Query('src') src: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.cameras.media(
      path ?? '',
      range,
      src === 'hls' ? 'hls' : 'api',
    );
    res
      .status(out.status)
      .set({ ...out.headers, 'Content-Type': out.contentType })
      .send(out.body);
  }
}

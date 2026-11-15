import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import type { Request, Response } from 'express';
import { MediaFilesService } from '../services/media-files.service.js';
import type { ResolvedMedia } from '../services/media-files.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { ListMediaQueryDto } from '../dto/list-media-query.dto.js';
import { VisibilityDto } from '../dto/visibility.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

@Controller()
export class MediaFilesController {
  constructor(
    private readonly storageService: StorageService,
    private readonly mediaFilesService: MediaFilesService,
  ) {}

  // REC-006 (UC-120): list media_files theo meeting.
  @Get('meetings/:meetingId/media-files')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.files.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async list(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Query() query: ListMediaQueryDto,
  ) {
    const { items, meta } = await this.mediaFilesService.list(meetingId, query);
    return {
      success: true,
      message: 'Media files retrieved',
      data: items,
      meta,
    };
  }

  // REC-006 (UC-121): chi tiết media_file.
  @Get('media-files/:fileId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.files.read')
  async detail(@Param('fileId', ParseUUIDPipe) fileId: string) {
    const data = await this.mediaFilesService.detail(fileId);
    return {
      success: true,
      message: 'Media file retrieved',
      data,
    };
  }

  // REC-006 (UC-122 v1 local): stream playback + HTTP Range.
  @Get('media-files/:fileId/playback')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.files.play')
  async playback(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const m = await this.mediaFilesService.resolvePlayback(fileId);
    res.setHeader('Content-Type', m.mimeType);
    await this.streamWithRangeSupport(req, res, m);
  }

  /**
   * [FIX 2026-08-15] Range/206 dùng chung cho /playback VÀ /secure-download — trước đây
   * /secure-download quảng cáo `Accept-Ranges: bytes` nhưng luôn trả 200 full file, bỏ qua
   * header Range thật (trình duyệt tưởng seek/partial-load được nhưng không), gây lỗi phát
   * lại video. Tái dùng nguyên logic đã đúng của /playback — KHÔNG viết lại. Chỉ xử lý
   * Range + stream; header xác thực/Content-Disposition/... vẫn do caller tự set trước khi
   * gọi hàm này (KHÔNG đổi cơ chế xác thực riêng của từng route).
   */
  private async streamWithRangeSupport(
    req: Request,
    res: Response,
    m: ResolvedMedia,
  ): Promise<void> {
    const onError = () => {
      // KHÔNG lộ đường dẫn nội bộ.
      if (!res.headersSent) res.status(500).end();
      else res.end();
    };

    res.setHeader('Accept-Ranges', 'bytes');
    const range: string | undefined = req.headers?.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      const range416 = () => {
        res.writeHead(416, { 'Content-Range': `bytes */${m.size}` });
        res.end();
      };
      if (!match || (match[1] === '' && match[2] === '')) {
        range416();
        return;
      }
      let start: number;
      let end: number;
      if (match[1] === '') {
        // suffix 'bytes=-N' → N byte cuối.
        const n = parseInt(match[2], 10);
        if (Number.isNaN(n) || n === 0) {
          range416();
          return;
        }
        start = Math.max(0, m.size - n);
        end = m.size - 1;
      } else {
        start = parseInt(match[1], 10);
        if (Number.isNaN(start) || start >= m.size) {
          range416();
          return;
        }
        end = match[2] ? parseInt(match[2], 10) : m.size - 1;
        if (Number.isNaN(end)) {
          range416();
          return;
        }
        end = Math.min(end, m.size - 1); // clamp thay vì 416.
        if (end < start) {
          range416();
          return;
        }
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${m.size}`,
        'Content-Length': end - start + 1,
      });
      const stream = await this.openMediaStream(m, start, end);
      stream.on('error', onError);
      stream.pipe(res);
      return;
    }

    res.writeHead(200, { 'Content-Length': m.size });
    const stream = await this.openMediaStream(m);
    stream.on('error', onError);
    stream.pipe(res);
  }

  /**
   * Mở stream đọc theo đúng nơi file đang nằm. `start`/`end` inclusive; bỏ trống = full file.
   * Nhánh `remote` (s3/MinIO) dùng getPartialObject nên seek không phải tải cả file về.
   */
  private async openMediaStream(
    m: ResolvedMedia,
    start?: number,
    end?: number,
  ): Promise<NodeJS.ReadableStream> {
    if (m.kind === 'remote') {
      return this.storageService.getObjectStream(m.storageKey, start, end);
    }
    return start === undefined
      ? createReadStream(m.path)
      : createReadStream(m.path, { start, end });
  }

  // REC-006 (UC-123): ẩn/xóa-mềm media_file.
  @Patch('media-files/:fileId/visibility')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.files.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async setVisibility(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: VisibilityDto,
    @Req() req: Request,
  ) {
    const userId =
      (req as any).user?.userId ||
      (req as any).user?.sub ||
      (req as any).user?.id ||
      '';
    const data = await this.mediaFilesService.setVisibility(
      fileId,
      dto,
      userId,
    );
    return {
      success: true,
      message: 'Media file visibility updated',
      data,
    };
  }

  // ACCT-AVATAR-REVIEW-001: secure download via signed token (no JWT, uses HMAC token).
  @Get('media-files/:fileId/secure-download')
  @HttpCode(200)
  async secureDownload(
    @Query('token') token: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = this.storageService.verifySignedDownloadToken(token);
    if (!result || result.mediaFileId !== fileId) {
      res.status(403).json({
        success: false,
        message: 'Forbidden',
        error: { code: 'FORBIDDEN', details: {} },
        timestamp: new Date().toISOString(),
        path: req.url,
      });
      return;
    }
    const resolved = await this.mediaFilesService.resolveSecureDownload(fileId);
    if (resolved.kind === 'redirect') {
      res.redirect(302, resolved.url);
      return;
    }
    const m = resolved;
    res.setHeader('Content-Type', m.mimeType);
    // fileName lấy từ DB — nhánh remote không có đường dẫn đĩa để cắt lấy tên.
    const filename =
      m.fileName || (m.kind === 'local' ? m.path.split(/[\\/]/).pop() : 'file');
    // feat-attach-meeting-agenda-document: FE nhúng ảnh/PDF/video trực tiếp
    // (<img>/<iframe>/<video src={agendaDocUrl}>) để xem tài liệu ngay trong
    // phòng họp thay vì bắt tải xuống trước. `Content-Disposition: attachment`
    // ép trình duyệt tải file nên iframe/img luôn trống — chỉ những định dạng
    // FE tự render inline mới bỏ "attachment"; các định dạng khác (docx/pptx/...)
    // vẫn ép tải để không đổi hành vi nút "Tải xuống" hiện có.
    const isInlineViewable =
      m.mimeType === 'application/pdf' ||
      m.mimeType.startsWith('image/') ||
      m.mimeType.startsWith('video/') ||
      m.mimeType.startsWith('audio/');
    res.setHeader(
      'Content-Disposition',
      (isInlineViewable ? 'inline' : 'attachment') +
        '; filename="' +
        filename +
        '"',
    );
    await this.streamWithRangeSupport(req, res, m);
  }
}

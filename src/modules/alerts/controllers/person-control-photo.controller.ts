import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { JwtQueryOrHeaderAuthGuard } from '../../auth/guards/jwt-query-or-header-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { StorageService } from '../../storage/storage.service.js';
import { PersonControlListService } from '../services/person-control-list.service.js';

/**
 * PersonControlPhotoController — trả ảnh chân dung của 1 bản ghi danh sách kiểm soát.
 * Tách riêng khỏi PersonControlListController (mirror IvssDeviceEventSnapshotController)
 * để dùng JwtQueryOrHeaderAuthGuard: thẻ `<img src>` chỉ gắn token qua `?token=`.
 */
@ApiTags('Person Control List')
@Controller('person-control-list')
@UseGuards(JwtQueryOrHeaderAuthGuard, PermissionsGuard)
@RequirePermissions('person_control_list.read')
export class PersonControlPhotoController {
  constructor(
    private readonly personControlListService: PersonControlListService,
    private readonly storageService: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  @Get(':id/photo')
  @ApiOperation({
    summary:
      'Ảnh chân dung của người trong danh sách kiểm soát (chấp nhận ?token= để dùng trong <img>)',
  })
  async photo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const entity = await this.personControlListService.findOne(id);
    const rows: {
      storage_key: string;
      mime_type: string;
      file_name: string;
    }[] = entity.photoMediaFileId
      ? await this.dataSource.manager.query(
          `SELECT storage_key, mime_type, file_name FROM media_files WHERE id = $1 LIMIT 1`,
          [entity.photoMediaFileId],
        )
      : [];
    const media = rows[0];
    if (!media) {
      throw new NotFoundException({
        code: 'PERSON_CONTROL_PHOTO_NOT_FOUND',
        message: 'Bản ghi không có ảnh chân dung.',
      });
    }
    const buffer = await this.storageService.downloadFile(media.storage_key);
    res.setHeader('Content-Type', media.mime_type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${media.file_name}"`,
    );
    res.send(buffer);
  }
}

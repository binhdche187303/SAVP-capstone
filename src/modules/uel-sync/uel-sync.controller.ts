import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { UelSyncRunDto } from './uel-sync-run.dto.js';
import { UelSyncService } from './uel-sync.service.js';

/** Đồng bộ dữ liệu API Đào tạo UEL — chỉ quản trị cấu hình hệ thống. */
@ApiTags('Administration')
@Controller('uel-sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('admin.manage_config')
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class UelSyncController {
  constructor(private readonly sync: UelSyncService) {}

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Chạy đồng bộ UEL (chạy nền)',
    description:
      'Bước: departments → staff → students → sections → enrollments → sessions. ' +
      'sections/enrollments cần namHoc + hocKy; sessions cần fromDate/toDate. Xem kết quả ở GET /uel-sync/status.',
  })
  run(@Body() dto: UelSyncRunDto) {
    // Lỗi tham số / đang chạy được ném đồng bộ (400/409); phần còn lại chạy nền.
    void this.sync.start(dto).catch(() => undefined);
    return { accepted: true, run: this.sync.lastResult };
  }

  @Get('status')
  @ApiOperation({ summary: 'Trạng thái + kết quả lượt đồng bộ UEL gần nhất' })
  status() {
    return { running: this.sync.isRunning, lastRun: this.sync.lastResult };
  }
}

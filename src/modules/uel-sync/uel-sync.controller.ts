import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { UelLookupDto } from './uel-lookup.dto.js';
import { UelLookupService } from './uel-lookup.service.js';
import { UelSyncRunDto } from './uel-sync-run.dto.js';
import {
  StudyPeriodsDto,
  UelSyncSettingsDto,
} from './uel-sync-settings.dto.js';
import {
  runAllPlanOf,
  UelSyncSettingsService,
} from './uel-sync-settings.service.js';
import { scheduleLabelOf, UelSyncScheduler } from './uel-sync.scheduler.js';
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
  constructor(
    private readonly sync: UelSyncService,
    private readonly settings: UelSyncSettingsService,
    private readonly scheduler: UelSyncScheduler,
    private readonly lookupService: UelLookupService,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Chạy đồng bộ UEL (chạy nền)',
    description:
      'Bước: departments → staff → students → sections → enrollments → sessions. ' +
      'sections/enrollments cần namHoc + hocKy; sessions cần fromDate/toDate (thêm lecturerCodes/studentCodes ⇒ chỉ lấy lịch các người đó, không hủy buổi). Xem kết quả ở GET /uel-sync/status.',
  })
  run(@Body() dto: UelSyncRunDto, @CurrentUser() user?: { userId?: string }) {
    // Lỗi tham số / đang chạy được ném đồng bộ (400/409); phần còn lại chạy nền.
    void this.sync
      .start(dto, { trigger: 'manual', requestedBy: user?.userId ?? null })
      .catch(() => undefined);
    return { accepted: true, run: this.sync.lastResult };
  }

  @Post('run-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Đồng bộ toàn bộ UEL (1 nút, chạy nền)',
    description:
      'Chạy đủ 6 bước. Học kỳ: tự nhận từ TKB các ngày tới (termMode=auto) hoặc học kỳ chỉ định trong cài đặt. ' +
      'Lịch học chỉ lấy từ hôm nay đến hôm nay + sessionDaysAhead − 1 (không lấy quá khứ). 409 khi đang có lượt khác.',
  })
  async runAll(@CurrentUser() user?: { userId?: string }) {
    const plan = runAllPlanOf(await this.settings.getSettings(), new Date());
    void this.sync
      .startAll(plan, { trigger: 'manual', requestedBy: user?.userId ?? null })
      .catch(() => undefined);
    return { accepted: true, run: this.sync.lastResult };
  }

  @Get('status')
  @ApiOperation({
    summary:
      'Tình trạng đồng bộ UEL: đã cấu hình chưa, lịch tự động, cài đặt, lượt gần nhất',
  })
  async status() {
    const [settings, periods, recent] = await Promise.all([
      this.settings.getSettings(),
      this.settings.getPeriods(),
      this.sync.history(1),
    ]);
    return {
      configured: this.sync.configured,
      running: this.sync.isRunning,
      schedule: {
        enabled: this.scheduler.enabled,
        serverAllowed: this.scheduler.serverAllowed,
        nextRunAt: this.scheduler.nextRunAt,
        label: scheduleLabelOf(settings),
      },
      settings,
      periodCount: periods.length,
      lastRun: recent[0] ?? this.sync.lastResult,
    };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Lịch sử các lượt đồng bộ UEL, mới nhất trước' })
  runs(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.sync.history(limit);
  }

  @Get('settings')
  @ApiOperation({
    summary:
      'Cài đặt đồng bộ tự động (bật/tắt, tần suất, giờ, cách chọn học kỳ, số ngày lịch học)',
  })
  getSettings() {
    return this.settings.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Cập nhật cài đặt đồng bộ tự động' })
  async updateSettings(
    @Body() dto: UelSyncSettingsDto,
    @CurrentUser() user?: { userId?: string },
  ) {
    const saved = await this.settings.updateSettings(dto, user?.userId ?? null);
    this.scheduler.apply(saved); // đổi lịch chạy có hiệu lực ngay
    return saved;
  }

  @Get('periods')
  @ApiOperation({
    summary: 'Bảng giờ tiết học (tiết → giờ) dùng để quy đổi lịch học UEL',
  })
  getPeriods() {
    return this.settings.getPeriods();
  }

  @Put('periods')
  @ApiOperation({ summary: 'Thay toàn bộ bảng giờ tiết học' })
  replacePeriods(@Body() dto: StudyPeriodsDto) {
    return this.settings.replacePeriods(dto.periods);
  }

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tra cứu trực tiếp từ API UEL (1 người / 1 ngày / 1 buổi)',
    description:
      'Chuyển tiếp tới 6 API tra cứu của Đào tạo UEL, không ghi vào DB. 502 khi API UEL báo lỗi, 503 khi chưa cấu hình key.',
  })
  lookup(@Body() dto: UelLookupDto) {
    return this.lookupService.lookup(dto);
  }
}

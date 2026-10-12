import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import { PublicRegistrationDto } from '../dto/public-registration.dto.js';
import { PublicRateLimit, PublicRateLimitGuard } from '../guards/public-rate-limit.guard.js';
import { VisitorsEnabledGuard } from '../guards/visitors-enabled.guard.js';
import { toPublicVisitView, toVisitView } from '../presenters/visit-view.presenter.js';
import { VisitorHostService } from '../services/visitor-host.service.js';
import { VisitService } from '../services/visit.service.js';

const bodyPipe = new ValidationPipe({ whitelist: true, transform: true });
const ok = (message: string, data: unknown) => ({ success: true, message, data, meta: {} });

/**
 * Ba endpoint CÔNG KHAI của phân hệ Khách (ngoại lệ SEC-02, spec §7.1): khách chưa có tài khoản.
 * Bảo vệ bằng giới hạn tần suất theo IP; lượt tạo ra chỉ ở `pending_approval`, chưa cấp quyền gì.
 */
@ApiTags('Visitors (public)')
@Controller('public')
@UseGuards(VisitorsEnabledGuard, PublicRateLimitGuard)
export class PublicVisitorController {
  constructor(
    private readonly visits: VisitService,
    private readonly hosts: VisitorHostService,
    private readonly config: VisitorConfigService,
  ) {}

  @Post('visitor-registrations')
  @PublicRateLimit('register')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(bodyPipe)
  @ApiOperation({ summary: 'Khách tự đăng ký đến làm việc (công khai, giới hạn tần suất)' })
  async register(@Body() dto: PublicRegistrationDto) {
    const view = await this.visits.create('online', dto, null);
    return ok('Đã nhận đăng ký. Kết quả sẽ được gửi qua email.', view);
  }

  @Get('visitor-registrations/:code')
  @PublicRateLimit('lookup')
  @ApiOperation({ summary: 'Khách tra cứu trạng thái đăng ký bằng mã lượt (không lộ dữ liệu cá nhân)' })
  async lookup(@Param('code') code: string) {
    const row = await this.visits.loadRowByCode(code);
    if (!row) {
      throw new NotFoundException({ success: false, message: 'Không tìm thấy lượt đăng ký với mã này', error: { code: 'VISIT_NOT_FOUND', details: {} } });
    }
    const view = toVisitView(row, new Date(), (await this.config.get()).overstayEscalateMinutes);
    return ok('OK', toPublicVisitView(view));
  }

  @Get('visitor-purposes')
  @PublicRateLimit('lookup')
  @ApiOperation({ summary: 'Danh sách mục đích đến làm việc cho trang đăng ký công khai' })
  async purposes() {
    return ok('OK', { purposes: (await this.config.get()).purposes });
  }

  @Get('visitor-hosts')
  @PublicRateLimit('hosts')
  @ApiOperation({ summary: 'Tìm người cần gặp (chỉ họ tên và đơn vị)' })
  async searchHosts(@Query('q') q = '') {
    if (!(await this.config.get()).publicHostSearchEnabled) {
      throw new ForbiddenException({ success: false, message: 'Tính năng tìm người cần gặp đang tắt', error: { code: 'HOST_SEARCH_DISABLED', details: {} } });
    }
    return ok('OK', await this.hosts.search(String(q)));
  }

  @Get('visitor-hosts/:id')
  @PublicRateLimit('hosts')
  @ApiOperation({ summary: 'Lấy thông tin người cần gặp theo id (cho link mời ?host=)' })
  async getHost(@Param('id') id: string) {
    const host = await this.hosts.findById(id);
    if (!host) throw new NotFoundException({ success: false, message: 'Không tìm thấy người cần gặp', error: { code: 'HOST_NOT_FOUND', details: {} } });
    return ok('OK', host);
  }
}

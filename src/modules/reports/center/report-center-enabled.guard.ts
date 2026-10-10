import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** `REPORT_CENTER_ENABLED=false` (mặc định) → các route Trung tâm báo cáo trả 404 như chưa tồn tại. */
@Injectable()
export class ReportCenterEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const v = this.config.get<boolean | string>('REPORT_CENTER_ENABLED', false);
    if (v === true || v === 'true') return true;
    throw new NotFoundException({ success: false, message: 'Không tìm thấy', error: { code: 'NOT_FOUND', details: {} } });
  }
}

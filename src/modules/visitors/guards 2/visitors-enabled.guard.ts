import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cờ VISITORS_ENABLED (mặc định tắt). Tắt → mọi route của module trả 404 như chưa tồn tại.
 * Dùng guard thay vì đăng ký module có điều kiện vì .env chỉ được nạp sau khi AppModule được định nghĩa.
 */
@Injectable()
export class VisitorsEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<boolean>('VISITORS_ENABLED', false) !== true) {
      throw new NotFoundException({ success: false, message: 'Not Found', error: { code: 'NOT_FOUND', details: {} } });
    }
    return true;
  }
}

import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';
import { GUEST_ACCESS_ERROR_CODES } from '../constants/guest-access-error.constant.js';
import { GuestRequestContext } from '../types/guest-jwt-payload.type.js';

/**
 * GuestMeetingScopeGuard — chạy SAU `GuestSessionGuard`.
 *
 * 1. So `params.meetingId` với `request.guest.meetingId` (token) — lệch thì
 *    403 `GUEST_MEETING_SCOPE_MISMATCH`, kể cả khi token còn hợp lệ về mặt
 *    chữ ký/thời hạn (spec FR-GLA-022).
 * 2. Đọc TƯƠI `meetings.status`/`endTime` từ DB (không tin giá trị nhúng
 *    trong JWT) — meeting `cancelled`/`completed` thì từ chối ngay
 *    (FR-GLA-015/032), và chặn trên bằng `endTime + joinWindowAfterMinutes`
 *    để phiên tự "nới" theo gia hạn cuộc họp (research.md rủi ro #6).
 *
 * LƯU Ý: cửa sổ "trước giờ họp" (`startTime - joinWindowBeforeMinutes`,
 * FR-GLA-017) CHỈ áp dụng cho bước gửi/xác minh OTP (`GuestOtpService`) —
 * KHÔNG áp dụng ở đây, vì một khách ĐÃ được admit không nên bị chặn xem nội
 * dung chỉ vì check lại điều kiện "trước giờ họp" (quickstart S8).
 */
@Injectable()
export class GuestMeetingScopeGuard implements CanActivate {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: GuestAccessConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const guest = (request as unknown as { guest?: GuestRequestContext }).guest;
    const meetingIdParam = request.params?.meetingId;

    if (!guest || !meetingIdParam || guest.meetingId !== meetingIdParam) {
      throw this.scopeMismatch();
    }

    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingIdParam } });

    if (!meeting || meeting.deletedAt) {
      throw this.scopeMismatch();
    }

    if (meeting.status === MeetingStatus.CANCELLED) {
      throw this.meetingCancelled();
    }

    const joinWindowAfterMs =
      this.config.getJoinWindowAfterMinutes() * 60 * 1000;
    const upperBound = meeting.endTime.getTime() + joinWindowAfterMs;
    if (Date.now() > upperBound) {
      throw this.meetingCancelled();
    }

    return true;
  }

  private scopeMismatch(): ForbiddenException {
    return new ForbiddenException({
      success: false,
      message: 'Phiên truy cập không khớp với cuộc họp này.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_MEETING_SCOPE_MISMATCH,
        details: {},
      },
    });
  }

  private meetingCancelled(): ConflictException {
    return new ConflictException({
      success: false,
      message: 'Cuộc họp đã hủy hoặc đã kết thúc, không thể tiếp tục truy cập.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_MEETING_CANCELLED,
        details: {},
      },
    });
  }
}

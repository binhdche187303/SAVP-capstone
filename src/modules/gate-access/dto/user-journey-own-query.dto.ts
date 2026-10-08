import { IsOptional, Matches } from 'class-validator';

/**
 * UserJourneyOwnQueryDto (UJN-001, own route) — query cho GET /campus/user-journey/me.
 *
 * Không có `userId`: route "own" luôn lấy từ `@CurrentUser()` (JWT), mirror
 * `ListGateAccessHistoryQueryDto` (gate-access-history.controller.ts route `history`).
 */
export class UserJourneyOwnQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date phải theo định dạng YYYY-MM-DD',
  })
  date?: string;

  /** Ngày cuối (YYYY-MM-DD, tính cả ngày này). Có `to` ⇒ trả hành trình cả khoảng [date, to], tối đa 31 ngày. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to phải theo định dạng YYYY-MM-DD',
  })
  to?: string;
}

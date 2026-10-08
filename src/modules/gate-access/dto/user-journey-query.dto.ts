import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * UserJourneyQueryDto (UJN-001) — query cho GET /campus/user-journey.
 *
 * `date` dạng YYYY-MM-DD (ngày thuần); thiếu → service lấy hôm nay THEO GIỜ VN.
 * Dùng @Matches thay @IsDateString vì biên ngày tính bằng `$2::date` trong SQL —
 * nhận ISO có giờ/offset sẽ làm cast sai.
 */
export class UserJourneyQueryDto {
  @IsUUID('4', { message: 'userId phải là UUID hợp lệ' })
  userId: string;

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

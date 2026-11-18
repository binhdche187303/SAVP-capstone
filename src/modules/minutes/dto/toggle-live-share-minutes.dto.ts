import { IsBoolean } from 'class-validator';

/**
 * Body cho PATCH /meeting-minutes/:id/live-share (MKM-LIVE-01).
 * Bat buoc truyen enabled — khong cho phep "khong truyen = giu nguyen" de
 * tranh nham lan y dinh cua client.
 */
export class ToggleLiveShareMinutesDto {
  @IsBoolean({ message: 'enabled phải là kiểu boolean' })
  enabled: boolean;
}

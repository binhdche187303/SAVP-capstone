import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** GET /api/v1/iot-devices/:id/connection-history?days=30 — số ngày nhìn lại (1–90). */
export class ConnectionHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 30;
}

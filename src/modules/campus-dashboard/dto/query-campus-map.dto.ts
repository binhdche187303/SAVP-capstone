import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** QueryCampusMapDto — query cho `GET /api/v1/campus-dashboard/map`. */
export class QueryCampusMapDto {
  /** Cửa sổ sự kiện an ninh tính ngược từ hiện tại (giờ). Mặc định 24, tối đa 7 ngày. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;
}

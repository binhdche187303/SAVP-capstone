import {
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query cho GET /rooms/search (UC-ROOM-04).
 * Mo cho moi user da dang nhap, khong yeu cau permission rieng.
 */
export class SearchRoomsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'capacityMin phai la so nguyen' })
  @Min(1, { message: 'capacityMin phai tu 1 tro len' })
  capacityMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'capacityMax phai la so nguyen' })
  @Min(1, { message: 'capacityMax phai tu 1 tro len' })
  capacityMax?: number;

  @IsOptional()
  @IsString({ message: 'areaName phai la chuoi ky tu' })
  @MaxLength(255, { message: 'areaName toi da 255 ky tu' })
  areaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  siteName?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'onlyAvailable phai la boolean' })
  onlyAvailable?: boolean;

  /** Tim theo roomName/roomCode (ILIKE, khong phan biet hoa/thuong). */
  @IsOptional()
  @IsString({ message: 'q phai la chuoi ky tu' })
  @MaxLength(255, { message: 'q toi da 255 ky tu' })
  q?: string;

  /** Loc theo trang thai TINH REAL-TIME (xem RoomSearchService.computeStatus). */
  @IsOptional()
  @IsIn(['available', 'occupied', 'reserved', 'maintenance', 'inactive'], {
    message:
      'status khong hop le. Gia tri: available, occupied, reserved, maintenance, inactive',
  })
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phai la so nguyen' })
  @Min(1, { message: 'page phai tu 1 tro len' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phai la so nguyen' })
  @Min(1, { message: 'limit phai tu 1 tro len' })
  @Max(100, { message: 'limit khong duoc vuot qua 100' })
  limit?: number = 50;
}

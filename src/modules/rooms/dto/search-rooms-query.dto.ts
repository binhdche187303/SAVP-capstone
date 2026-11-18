import type { FilterSelection } from '../../../common/utils/filter-selection.js';
import {
  IsOptional,
  IsArray,
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Query cho GET /rooms/search (UC-ROOM-04).
 * Mo cho moi user da dang nhap, khong yeu cau permission rieng.
 */
export class SearchRoomsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Sức chứa tối thiểu phải là số nguyên' })
  @Min(1, { message: 'Sức chứa tối thiểu phải từ 1 trở lên' })
  capacityMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Sức chứa tối đa phải là số nguyên' })
  @Min(1, { message: 'Sức chứa tối đa phải từ 1 trở lên' })
  capacityMax?: number;

  @IsOptional()
  @IsString({ message: 'Tên khu vực phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'Tên khu vực tối đa 255 ký tự' })
  areaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  siteName?: string;

  /** Exact site/area pairs, serialized by the location filter. */
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : Array.isArray(value) ? value : [value])
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(600, { each: true })
  locations?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'onlyAvailable phải là boolean' })
  onlyAvailable?: boolean;

  /** Tim theo roomName/roomCode (ILIKE, khong phan biet hoa/thuong). */
  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'Từ khóa tìm kiếm tối đa 255 ký tự' })
  q?: string;

  /** Loc theo trang thai TINH REAL-TIME (xem RoomSearchService.computeStatus). */
  @IsOptional()
  @IsIn(['available', 'occupied', 'reserved', 'maintenance', 'inactive'], { each: true,
    message:
      'Trạng thái không hợp lệ. Giá trị: available, occupied, reserved, maintenance, inactive',
  })
  status?: FilterSelection<string>;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải từ 1 trở lên' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải từ 1 trở lên' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  limit?: number = 50;
}

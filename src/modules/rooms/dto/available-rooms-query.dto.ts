import { IsInt, IsISO8601, IsNotEmpty, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query cho GET /rooms/available (yeu cau FE, xem
 * Docs/Nam_Sent/backend_api_requirements_available_rooms.md).
 * startTime/endTime bat buoc; minCapacity tuy chon. Mo cho moi user da dang
 * nhap, khong yeu cau permission rieng (giong SearchRoomsQueryDto).
 */
export class AvailableRoomsQueryDto {
  @IsNotEmpty({ message: 'Thời gian bắt đầu là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'Thời gian bắt đầu phải đúng định dạng ISO-8601 có múi giờ' },
  )
  startTime: string;

  @IsNotEmpty({ message: 'Thời gian kết thúc là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'Thời gian kết thúc phải đúng định dạng ISO-8601 có múi giờ' },
  )
  endTime: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Sức chứa tối thiểu phải là số nguyên' })
  @Min(1, { message: 'Sức chứa tối thiểu phải từ 1 trở lên' })
  minCapacity?: number;
}

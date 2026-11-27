import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * QuerySearchDto (SRCH-01) — `q` bắt buộc ≥2 ký tự (spec R2, tránh full-scan).
 * `types` optional, comma-separated — validate allowlist thủ công ở controller
 * (spec §2.2 — không dùng decorator enum-array phức tạp cho 1 field đơn giản).
 */
export class QuerySearchDto {
  @ApiProperty({
    description: 'Từ khóa tìm kiếm, 2–100 ký tự',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @MinLength(2)
  // Chuỗi rất dài (5.000 ký tự) làm truy vấn ILIKE chạy ~3s — giới hạn để chống làm chậm server.
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    description:
      'Danh sách loại đối tượng cần tìm, phân cách bởi dấu phẩy (bỏ trống = tìm tất cả loại được phép)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  types?: string;
}

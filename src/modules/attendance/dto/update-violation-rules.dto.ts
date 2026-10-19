import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ViolationRuleItemDto {
  /** Có id = sửa hình thức cũ; không id = thêm hình thức mới (ghi nhận thủ công). */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  ruleName: string;

  @IsInt()
  @Min(-100)
  @Max(100)
  penaltyPoints: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conditionText?: string | null;

  @IsBoolean()
  isActive: boolean;
}

export class UpdateViolationRulesDto {
  /** Thứ tự trong mảng = thứ tự hiển thị. */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ViolationRuleItemDto)
  rules: ViolationRuleItemDto[];

  /** Chỉ xoá được hình thức tự thêm (không phải hệ thống). */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  deleteIds?: string[];

  @IsInt()
  @Min(0)
  @Max(120)
  lateGraceMinutes: number;

  @IsInt()
  @Min(0)
  @Max(240)
  earlyLeaveThresholdMinutes: number;
}

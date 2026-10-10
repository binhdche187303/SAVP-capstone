import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class ListVisitsQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() hostId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 10;
}

export class VisitorStatsQueryDto {
  @Matches(YMD) from!: string;
  @Matches(YMD) to!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() groupBy?: 'day' | 'week' | 'month';
}

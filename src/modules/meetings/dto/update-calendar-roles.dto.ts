import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';

export const LEADERSHIP_TITLES = ['HIEU_TRUONG', 'PHO_HIEU_TRUONG', 'BI_THU', 'PHO_BI_THU'] as const;

export class LeaderItemDto {
  @IsUUID('4', { message: 'userId không hợp lệ' })
  userId!: string;

  @IsIn(LEADERSHIP_TITLES, { message: 'Chức danh lãnh đạo không hợp lệ' })
  leadershipTitle!: (typeof LEADERSHIP_TITLES)[number];
}

export class UpdateCalendarRolesDto {
  @IsUUID('4', { message: 'Đơn vị duyệt lịch cấp trường không hợp lệ' })
  schoolApproverDepartmentId!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LeaderItemDto)
  leaders!: LeaderItemDto[];

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true, message: 'Danh sách văn thư không hợp lệ' })
  clerkUserIds!: string[];
}

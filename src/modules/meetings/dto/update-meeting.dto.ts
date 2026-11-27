import { IsOptional, IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';

/**
 * UpdateMeetingDto (BE-03, PATCH /meetings/:meetingId) — pham vi CO Y HEP:
 * chi title/description. Time/room/participants/agenda/recording da co
 * endpoint chuyen trach rieng, KHONG gop vao day (forbidNonWhitelisted:true
 * se tra 400 cho cac field khac neu FE gui nham).
 */
export class UpdateMeetingDto {
  @IsOptional()
  @IsString({ message: 'Tiêu đề cuộc họp phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tiêu đề cuộc họp không được để trống' })
  @Matches(/\S/, { message: 'Tiêu đề cuộc họp không được để trống' })
  @MaxLength(255, { message: 'Tiêu đề cuộc họp tối đa 255 ký tự' })
  title?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  @MaxLength(2000, { message: 'Mô tả tối đa 2000 ký tự' })
  description?: string;
}

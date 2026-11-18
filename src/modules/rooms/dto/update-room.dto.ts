import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { RoomType } from '../entities/room.entity.js';

export class UpdateRoomDto {
  @IsOptional()
  @IsString({ message: 'Tên phòng phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tên phòng không được để trống' })
  @MaxLength(255, { message: 'Tên phòng tối đa 255 ký tự' })
  roomName?: string;

  @IsOptional()
  @IsString({ message: 'Tên khu vực phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tên khu vực không được để trống' })
  @MaxLength(255, { message: 'Tên khu vực tối đa 255 ký tự' })
  areaName?: string;

  @IsOptional()
  @IsString({ message: 'Tên cơ sở phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'Tên cơ sở tối đa 255 ký tự' })
  siteName?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả vị trí phải là chuỗi ký tự' })
  locationDescription?: string;

  @IsOptional()
  @IsInt({ message: 'Sức chứa phải là số nguyên' })
  @Min(1, { message: 'Sức chứa phải từ 1 trở lên' })
  @Max(1000, { message: 'Sức chứa không được vượt quá 1000' })
  capacity?: number;

  @IsOptional()
  @IsEnum(RoomType, {
    message:
      'Loại phòng không hợp lệ. Giá trị: meeting_room, training_room, board_room, open_space',
  })
  roomType?: RoomType;

  @IsOptional()
  @IsBoolean({ message: 'hasCamera phải là boolean' })
  hasCamera?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'hasMicrophone phải là boolean' })
  hasMicrophone?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'hasDisplay phải là boolean' })
  hasDisplay?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'allowRecording phải là boolean' })
  allowRecording?: boolean;
}

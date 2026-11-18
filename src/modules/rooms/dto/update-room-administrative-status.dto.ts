import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /rooms/:roomId/administrative-status — admin dat/go trang thai
 * CHU DONG cho phong (maintenance/inactive), tach bach khoi trang thai
 * occupied/reserved/available von duoc tinh real-time (xem
 * RoomSearchService/RoomStatusService.computeStatus). Gui 'available' de
 * go override hien tai.
 */
export class UpdateRoomAdministrativeStatusDto {
  @IsIn(['available', 'maintenance', 'inactive'], {
    message: "Trạng thái phải là 'available', 'maintenance' hoặc 'inactive'",
  })
  status: 'available' | 'maintenance' | 'inactive';

  @IsOptional()
  @IsString({ message: 'Lý do phải là chuỗi ký tự' })
  @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  reason?: string;
}

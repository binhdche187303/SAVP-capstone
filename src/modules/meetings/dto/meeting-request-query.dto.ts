import { IsOptional, IsString, IsUUID, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { Validate } from 'class-validator';
import { FromToConstraint } from '../validators/from-to.constraint.js';

export class MeetingRequestQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @IsIn([
    'pending',
    'approved',
    'rejected',
    'applied',
    'cancelled',
    'expired',
    'all',
  ])
  approvalStatus?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'create_meeting',
    'update_time',
    'update_room',
    'cancel_meeting',
    'extend_meeting',
    'book_room',
  ])
  requestType?: string;

  @IsOptional()
  @IsUUID('4')
  targetRoomId?: string;

  @IsOptional()
  @IsUUID('4')
  requestedById?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  @Validate(FromToConstraint, ['from'])
  to?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  @IsIn(['requested_at', 'created_at', 'approval_status', 'request_type'])
  sortBy?: string = 'requested_at';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc';
}

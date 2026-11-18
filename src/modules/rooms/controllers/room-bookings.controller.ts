import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UnprocessableEntityException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RoomBookingsService } from '../services/room-bookings.service.js';
import { RoomBookingQueryDto } from '../dto/room-booking-query.dto.js';

const ENUM_FIELDS_REQUIRING_422 = ['status', 'bookingType'];

export function roomBookingQueryExceptionFactory(errors: ValidationError[]) {
  const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
  const message = messages.length > 0 ? messages : ['Validation error'];

  const hasInvalidEnum = errors.some(
    (e) =>
      ENUM_FIELDS_REQUIRING_422.includes(e.property) && e.constraints?.isIn,
  );

  return hasInvalidEnum
    ? new UnprocessableEntityException(message)
    : new BadRequestException(message);
}

@Controller('room-bookings')
@UseGuards(JwtAuthGuard)
export class RoomBookingsController {
  constructor(private readonly roomBookingsService: RoomBookingsService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.booking.read')
  async findAll(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        exceptionFactory: roomBookingQueryExceptionFactory,
      }),
    )
    query: RoomBookingQueryDto,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.roomBookingsService.findRoomBookings(query, user);

    return {
      success: true,
      message: 'Danh sách đặt phòng',
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit) || 0,
      },
    };
  }
}

import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Catch TypeORM QueryFailedError và map PostgreSQL unique violation (23505) thành
 * 409 Conflict, PHÂN BIỆT THEO TÊN CONSTRAINT.
 *
 * ⚠ Bản cũ map MỌI 23505 thành DEPARTMENT_ALREADY_EXISTS: constraint lạ rơi vào nhánh
 * else nên trùng mã họp (`ux_meetings_code`) bị báo là "Tên phòng ban này đã được sử
 * dụng" — dán nhãn sai, làm người debug đi lạc hoàn toàn. Nay constraint không nhận
 * ra trả mã trung tính RESOURCE_ALREADY_EXISTS thay vì đoán bừa.
 *
 * Exclusion violation (23P01) trên `ex_room_bookings_no_overlap` → 409 ROOM_CONFLICT.
 *
 * Các error code khác trả về 500 Internal Server Error.
 */
@Catch(QueryFailedError)
export class QueryFailedFilter implements ExceptionFilter {
  private readonly logger = new Logger(QueryFailedFilter.name);

  /**
   * Map constraint name → mã lỗi + message cho người dùng.
   * Constraint KHÔNG khớp bảng nào → mã trung tính, TUYỆT ĐỐI không đoán sang domain khác.
   */
  static mapUniqueViolation(constraint: string): {
    code: string;
    message: string;
    field: string;
  } {
    const c = constraint.toLowerCase();

    if (c.includes('department_code')) {
      return {
        code: 'DEPARTMENT_ALREADY_EXISTS',
        message: 'Mã phòng ban này đã được sử dụng',
        field: 'departmentCode',
      };
    }
    if (c.includes('department_name')) {
      return {
        code: 'DEPARTMENT_ALREADY_EXISTS',
        message: 'Tên phòng ban này đã được sử dụng',
        field: 'departmentName',
      };
    }
    // Mã họp / mã booking do BE tự sinh — người dùng không nhập, nên hướng dẫn thử lại.
    if (c.includes('meetings_code') || c.includes('meeting_code')) {
      return {
        code: 'MEETING_CODE_CONFLICT',
        message: 'Không thể tạo mã cuộc họp, vui lòng thử lại',
        field: 'meetingCode',
      };
    }
    if (c.includes('room_bookings_code') || c.includes('booking_code')) {
      return {
        code: 'BOOKING_CODE_CONFLICT',
        message: 'Không thể tạo mã đặt phòng, vui lòng thử lại',
        field: 'bookingCode',
      };
    }
    if (c.includes('meeting_requests_code') || c.includes('request_code')) {
      return {
        code: 'REQUEST_CODE_CONFLICT',
        message: 'Không thể tạo mã yêu cầu đặt phòng, vui lòng thử lại',
        field: 'requestCode',
      };
    }

    return {
      code: 'RESOURCE_ALREADY_EXISTS',
      message: 'Dữ liệu bị trùng, vui lòng thử lại',
      field: 'unknown',
    };
  }

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const driverError = (exception as any).driverError;
    const code: string | undefined = driverError?.code;
    const requestId = (request.headers['x-request-id'] as string) || 'unknown';

    // PostgreSQL unique violation
    if (code === '23505') {
      const constraint: string = driverError?.constraint ?? '';

      this.logger.warn(
        `Unique constraint violation: ${constraint || '(không rõ)'} (requestId: ${requestId})`,
      );

      const mapped = QueryFailedFilter.mapUniqueViolation(constraint);

      response.status(HttpStatus.CONFLICT).json({
        success: false,
        message: mapped.message,
        error: {
          code: mapped.code,
          details: { field: mapped.field, constraint: constraint || null },
        },
        requestId,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    // PostgreSQL exclusion violation — A1 Lớp 2: 2 booking approved/active trùng
    // phòng/giờ lọt qua lock ở app (luồng quên gọi lockRoomsForBooking, script...).
    if (code === '23P01') {
      const constraint: string = driverError?.constraint ?? '';
      this.logger.warn(
        `Exclusion constraint violation: ${constraint || '(không rõ)'} (requestId: ${requestId})`,
      );
      const isRoomOverlap = constraint === 'ex_room_bookings_no_overlap';
      response.status(HttpStatus.CONFLICT).json({
        success: false,
        message: isRoomOverlap
          ? 'Phòng họp này vừa được đặt. Vui lòng chọn một phòng khác hoặc đổi khung giờ.'
          : 'Dữ liệu bị trùng, vui lòng thử lại',
        error: {
          code: isRoomOverlap ? 'ROOM_CONFLICT' : 'RESOURCE_ALREADY_EXISTS',
          details: { constraint: constraint || null },
        },
        requestId,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    // Other DB errors → 500
    this.logger.error(
      `Unhandled database error: ${exception.message} (code: ${code})`,
      exception.stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error',
      error: { code: 'INTERNAL_ERROR' },
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

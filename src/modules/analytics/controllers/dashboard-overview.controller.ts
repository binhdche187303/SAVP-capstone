import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { DashboardOverviewService } from '../services/dashboard-overview.service';
import { QueryDashboardOverviewDto } from '../dto/query-dashboard-overview.dto';
import { DashboardOverviewResponseDto } from '../dto/dashboard-overview-response.dto';

@ApiTags('Analytics Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.overview.read')
@Controller('analytics/dashboard')
export class DashboardOverviewController {
  constructor(private readonly dashboardService: DashboardOverviewService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Xem dashboard tong quan he thong (UC-AA-01)',
    description:
      'Tra ve 8 KPI va trend theo ngay. Du lieu tinh on-demand tu DB.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard tong quan tra ve thanh cong',
    type: DashboardOverviewResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED / DEPARTMENT_OUT_OF_SCOPE',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getOverview(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryDashboardOverviewDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: DashboardOverviewResponseDto;
  }> {
    try {
      const data = await this.dashboardService.getOverview(currentUser, query);
      return {
        success: true,
        message: 'Dữ liệu tổng quan được truy xuất thành công',
        data,
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException({
        success: false,
        message: 'Internal server error',
        error: { code: 'INTERNAL_ERROR', details: {} },
      });
    }
  }
}

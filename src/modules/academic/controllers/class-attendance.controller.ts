import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ClassAttendanceService } from '../services/class-attendance.service.js';

@Controller('class-attendance')
@UseGuards(JwtAuthGuard)
export class ClassAttendanceController {
  constructor(private readonly service: ClassAttendanceService) {}

  @Get('settings')
  async getSettings() {
    const data = await this.service.getSettings();
    return {
      success: true,
      message: 'Class attendance settings retrieved successfully',
      data,
    };
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      classStartTime?: string;
      lateThresholdMinutes?: number;
      autoScanIntervalSeconds?: number;
    },
  ) {
    const data = await this.service.updateSettings(user.userId, body);
    return {
      success: true,
      message: 'Class attendance settings updated successfully',
      data,
    };
  }

  @Get('classes')
  async listClasses(@CurrentUser() user: { userId: string }) {
    const data = await this.service.listClasses(user.userId);
    return {
      success: true,
      message: 'Class attendance classes retrieved successfully',
      data,
    };
  }

  @Get('classes/:classId/rows')
  async getRows(
    @CurrentUser() user: { userId: string },
    @Param('classId') classId: string,
    @Query('date') date?: string,
  ) {
    const data = await this.service.getRows(user.userId, classId, date);
    return {
      success: true,
      message: 'Class attendance rows retrieved successfully',
      data,
    };
  }

  @Get('classes/:classId/summary')
  async getSummary(
    @CurrentUser() user: { userId: string },
    @Param('classId') classId: string,
    @Query('date') date?: string,
  ) {
    const data = await this.service.getSummary(user.userId, classId, date);
    return {
      success: true,
      message: 'Class attendance summary retrieved successfully',
      data,
    };
  }

  @Post('scan')
  async scan(
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      classId?: string;
      direction?: 'in' | 'out' | 'enter' | 'leave';
      snapshotImageBase64?: string;
    },
  ): Promise<any> {
    const result = await this.service.scan(user.userId, body);
    return {
      success: result.success,
      message: result.data?.message ?? 'Class attendance scan processed',
      data: result.data ?? result,
    };
  }

  @Get('student/me')
  async getMyReport(
    @CurrentUser() user: { userId: string },
    @Query('mode') mode?: string,
    @Query('anchorDate') anchorDate?: string,
  ) {
    const data = await this.service.getStudentReport(user.userId, {
      mode,
      anchorDate,
    });
    return {
      success: true,
      message: 'Student class attendance report retrieved successfully',
      data,
    };
  }

  @Get('student/report')
  async getStudentReport(
    @CurrentUser() user: { userId: string },
    @Query('studentId') studentId?: string,
    @Query('mode') mode?: string,
    @Query('anchorDate') anchorDate?: string,
  ) {
    const data = await this.service.getStudentReport(user.userId, {
      studentId,
      mode,
      anchorDate,
    });
    return {
      success: true,
      message: 'Student class attendance report retrieved successfully',
      data,
    };
  }

  @Get('report')
  async getTeacherReport(
    @CurrentUser() user: { userId: string },
    @Query('classId') classId?: string,
    @Query('semester') semester?: string,
    @Query('mode') mode?: string,
    @Query('anchorDate') anchorDate?: string,
  ) {
    const data = await this.service.getTeacherReport(user.userId, {
      classId,
      semester,
      mode,
      anchorDate,
    });
    return {
      success: true,
      message: 'Teacher class attendance report retrieved successfully',
      data,
    };
  }

  @Get('export.csv')
  async exportSemesterCsv(
    @CurrentUser() user: { userId: string },
    @Query('classId') classId: string | undefined,
    @Query('semester') semester: string | undefined,
    @Res() res: any,
  ) {
    const result = await this.service.exportSemesterCsv(user.userId, {
      classId,
      semester,
    });
    res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(Buffer.from(`\uFEFF${result.csv}`, 'utf8'));
  }

  @Get('stats')
  async getStats(@CurrentUser() user: { userId: string }) {
    const data = await this.service.getStats(user.userId);
    return {
      success: true,
      message: 'Class attendance stats retrieved successfully',
      data,
    };
  }
}

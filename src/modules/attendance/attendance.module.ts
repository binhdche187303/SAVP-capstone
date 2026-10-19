import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceRecordEntity } from './entities/attendance-record.entity.js';
import { AttendanceEventEntity } from './entities/attendance-event.entity.js';
import { AttendanceController } from './controllers/attendance.controller.js';
import { CheckInAlertController } from './controllers/checkin-alert.controller.js';
import { ManualAttendanceController } from './controllers/manual-attendance.controller.js';
import { ViolationRulesController } from './controllers/violation-rules.controller.js';
import { AttendanceExcuseController } from './controllers/attendance-excuse.controller.js';
import { AttendanceExcuseService } from './services/attendance-excuse.service.js';
import { AttendancePenaltyReportController } from './controllers/attendance-penalty-report.controller.js';
import { AttendancePenaltyReportService } from './services/attendance-penalty-report.service.js';
import { ViolationRulesService } from './services/violation-rules.service.js';
import { AttendanceService } from './services/attendance.service.js';
import { CheckInAlertService } from './services/checkin-alert.service.js';
import { ManualAttendanceService } from './services/manual-attendance.service.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AccountsModule,
    AuthModule,
    MeetingsModule,
    RoomsModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      AttendanceRecordEntity,
      AttendanceEventEntity,
      MeetingEntity,
      MeetingParticipantEntity,
      UserEntity,
    ]),
  ],
  controllers: [
    AttendanceController,
    CheckInAlertController,
    ManualAttendanceController,
    ViolationRulesController,
    AttendanceExcuseController,
    AttendancePenaltyReportController,
  ],
  providers: [
    AttendanceService,
    CheckInAlertService,
    ManualAttendanceService,
    ViolationRulesService,
    AttendanceExcuseService,
    AttendancePenaltyReportService,
  ],
  exports: [TypeOrmModule, AttendanceService, CheckInAlertService],
})
export class AttendanceModule {}

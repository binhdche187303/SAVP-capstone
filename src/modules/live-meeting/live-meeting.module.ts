import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { GuestAccessModule } from '../guest-access/guest-access.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { AcademicModule } from '../academic/academic.module.js';
import { LiveMeetingService } from './services/live-meeting.service.js';
import { LiveMeetingController } from './controllers/live-meeting.controller.js';
import { MeetingWarningService } from './services/meeting-warning.service.js';
import { MeetingWarningProcessor } from './processors/meeting-warning.processor.js';

/**
 * LiveMeetingModule quản lý In-Meeting Management:
 * - UC-IMM-01: Bắt đầu phiên họp (Start Meeting Session)
 * - Import AuthModule để dùng JwtAuthGuard, PermissionsGuard
 * - Import WebsocketModule để dùng WebsocketService cho realtime push
 *
 * AdministrationModule là @Global nên AuditLogEntity và services đã có sẵn.
 * Entities từ MeetingsModule và RoomsModule được truy cập qua TypeORM repository.
 */
@Module({
  imports: [
    AuthModule,
    WebsocketModule,
    GuestAccessModule,
    RecordingModule,
    AcademicModule,
  ],
  controllers: [LiveMeetingController],
  providers: [
    LiveMeetingService,
    MeetingWarningService,
    MeetingWarningProcessor,
  ],
  exports: [LiveMeetingService],
})
export class LiveMeetingModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { VisitorConfigService } from './config/visitor-config.service.js';
import { MyVisitorsController } from './controllers/my-visitors.controller.js';
import { PublicVisitorController } from './controllers/public-visitor.controller.js';
import { VisitorDeskController } from './controllers/visitor-desk.controller.js';
import { VisitsController } from './controllers/visits.controller.js';
import { VisitorEntity } from './entities/visitor.entity.js';
import { VisitorVisitEntity } from './entities/visitor-visit.entity.js';
import { VisitorVisitEventEntity } from './entities/visitor-visit-event.entity.js';
import { VisitorVisitZoneEntity } from './entities/visitor-visit-zone.entity.js';
import { PublicRateLimitGuard } from './guards/public-rate-limit.guard.js';
import { VisitorsEnabledGuard } from './guards/visitors-enabled.guard.js';
import { VisitActionsService } from './services/visit-actions.service.js';
import { VisitCodeService } from './services/visit-code.service.js';
import { VisitQueryService } from './services/visit-query.service.js';
import { VisitService } from './services/visit.service.js';
import { VisitorDeviceSync } from './services/visitor-device-sync.js';
import { VisitorActorService } from './services/visitor-actor.service.js';
import { ZonesModule } from '../zones/zones.module.js';
import { VisitorGateService } from './services/visitor-gate.service.js';
import { VisitorFaceLifecycleService } from './services/visitor-face-lifecycle.service.js';
import { VisitorFaceGateService } from './services/visitor-facegate.service.js';
import { CompositeVisitorDeviceSync } from './services/composite-visitor-device-sync.js';
import { FaceAccessModule } from '../face-access/face-access.module.js';
import { VisitorHostService } from './services/visitor-host.service.js';
import { VisitorIdentityService } from './services/visitor-identity.service.js';
import { VisitorNotifier } from './services/visitor-notifier.service.js';

/**
 * VisitorsModule (VIS-BE-001) — phân hệ Khách đến làm việc (2.10).
 * KHÔNG @Global. ivss/face-access gọi sang qua token ở src/common/ports (tránh import vòng).
 * Luôn đăng ký, gate bằng VISITORS_ENABLED (xem VisitorsEnabledGuard).
 * Redis, Administration (audit), Queue, Mail, Storage là module toàn cục.
 */
@Module({
  imports: [
    FaceAccessModule,
    ConfigModule,
    AuthModule,
    AccountsModule,
    AlertsModule,
    NotificationsModule,
    ZonesModule,
    TypeOrmModule.forFeature([VisitorEntity, VisitorVisitEntity, VisitorVisitZoneEntity, VisitorVisitEventEntity]),
  ],
  controllers: [PublicVisitorController, VisitsController, VisitorDeskController, MyVisitorsController],
  providers: [
    VisitorConfigService,
    VisitorsEnabledGuard,
    PublicRateLimitGuard,
    VisitCodeService,
    VisitorIdentityService,
    VisitorHostService,
    VisitorActorService,
    VisitorNotifier,
    VisitService,
    VisitActionsService,
    VisitQueryService,
    VisitorFaceLifecycleService,
    VisitorFaceGateService,
    VisitorGateService,
    { provide: VisitorDeviceSync, useClass: CompositeVisitorDeviceSync },
  ],
  exports: [VisitorConfigService, VisitorGateService, VisitService, VisitActionsService, VisitQueryService, VisitorDeviceSync, VisitorFaceGateService],
})
export class VisitorsModule {}

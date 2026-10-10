// Dựng một app Nest thật cho controller + service của phân hệ Khách, chỉ giả ở biên hạ tầng
// (Redis, lưu ảnh, thông báo, audit). DB là Postgres thử (AppDataSource).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../src/database/data-source';
import { AuditLogsService } from '../../../src/modules/administration/services/audit-logs.service';
import { FaceProfileService } from '../../../src/modules/accounts/services/face-profile.service';
import { UsersService } from '../../../src/modules/accounts/services/users.service';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service';
import { RedisService } from '../../../src/modules/redis/redis.service';
import { VisitorConfigService } from '../../../src/modules/visitors/config/visitor-config.service';
import { VisitorsEnabledGuard } from '../../../src/modules/visitors/guards/visitors-enabled.guard';
import { PublicRateLimitGuard } from '../../../src/modules/visitors/guards/public-rate-limit.guard';
import { VisitsController } from '../../../src/modules/visitors/controllers/visits.controller';
import { VisitorDeskController } from '../../../src/modules/visitors/controllers/visitor-desk.controller';
import { MyVisitorsController } from '../../../src/modules/visitors/controllers/my-visitors.controller';
import { VisitorActorService } from '../../../src/modules/visitors/services/visitor-actor.service';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard';
import { AuthzReadRepository } from '../../../src/modules/auth/repositories/authz-read.repository';
import { UnauthorizedException } from '@nestjs/common';
import { PublicVisitorController } from '../../../src/modules/visitors/controllers/public-visitor.controller';
import { VisitCodeService } from '../../../src/modules/visitors/services/visit-code.service';
import { VisitorIdentityService } from '../../../src/modules/visitors/services/visitor-identity.service';
import { VisitorNotifier } from '../../../src/modules/visitors/services/visitor-notifier.service';
import { VisitService } from '../../../src/modules/visitors/services/visit.service';
import { VisitActionsService } from '../../../src/modules/visitors/services/visit-actions.service';
import { VisitorDeviceSync } from '../../../src/modules/visitors/services/visitor-device-sync';
import { AlertsService } from '../../../src/modules/alerts/services/alerts.service';
import { VisitQueryService } from '../../../src/modules/visitors/services/visit-query.service';
import { VisitorDevScanService } from '../../../src/modules/visitors/services/visitor-dev-scan.service';
import { VisitorGateService } from '../../../src/modules/visitors/services/visitor-gate.service';
import { GateAccessLogService } from '../../../src/modules/zones/services/gate-access-log.service';
import { GateAccessLogEntity } from '../../../src/modules/zones/entities/gate-access-log.entity';
import { VisitorHostService } from '../../../src/modules/visitors/services/visitor-host.service';

export interface TestRig {
  app: INestApplication;
  alerts: Array<Record<string, unknown>>;
  deviceSync: { syncVisit: jest.Mock };
  notifications: { created: Array<Record<string, unknown>>; emails: Array<Record<string, unknown>> };
  counters: Map<string, number>;
  /** userId → quyền hiệu lực (giả lập AuthzReadRepository). Header `x-test-user` chọn người gọi. */
  permissionsByUser: Map<string, string[]>;
  close(): Promise<void>;
}

export async function buildVisitorTestApp(opts: { enabled?: boolean } = {}): Promise<TestRig> {
  const counters = new Map<string, number>();
  const permissionsByUser = new Map<string, string[]>();
  const redis = {
    incr: async (k: string) => { counters.set(k, (counters.get(k) ?? 0) + 1); return counters.get(k); },
    expire: async () => undefined,
    ttl: async () => 300,
  };
  const alerts: Array<Record<string, unknown>> = [];
  const deviceSync = { syncVisit: jest.fn(async () => undefined) };
  const notifications = { created: [] as Array<Record<string, unknown>>, emails: [] as Array<Record<string, unknown>> };
  const notificationsService = {
    createNotification: async (dto: Record<string, unknown>) => { notifications.created.push(dto); return { id: 'n1' }; },
    listMyNotifications: async () => ({ data: [], meta: {} }),
    markAllNotificationsRead: async () => undefined,
    enqueueEmailNotification: async (dto: Record<string, unknown>) => { notifications.emails.push(dto); return { notification: { id: 'n2' } }; },
  };
  const faceProfiles = {
    getMediaDataUrl: async () => 'data:image/jpeg;base64,AAAA',
    enrollPortrait: async (userId: string) => {
      const rows = await AppDataSource.query(
        `INSERT INTO media_files (file_name, file_type, mime_type, storage_provider, storage_key)
         VALUES ('visitor-test.jpg','image','image/jpeg','local',$1) RETURNING id`,
        [`test/${userId}.jpg`],
      );
      return { faceProfileId: 'fp', mediaFileId: rows[0].id, status: 'pending_review' };
    },
  };
  const usersService = Object.create(UsersService.prototype) as UsersService;
  (usersService as unknown as { dataSource: DataSource }).dataSource = AppDataSource;

  const config = { get: (k: string, d?: unknown) => (k === 'VISITORS_ENABLED' ? opts.enabled ?? true : k === 'APP_URL' ? 'http://localhost:3000' : d) };
  const moduleRef = await Test.createTestingModule({
    controllers: [PublicVisitorController, VisitsController, VisitorDeskController, MyVisitorsController],
    providers: [
      VisitorConfigService, VisitCodeService, VisitorIdentityService, VisitService, VisitActionsService, VisitQueryService, VisitorGateService, VisitorDevScanService, VisitorHostService, VisitorNotifier, VisitorActorService,
      VisitorsEnabledGuard, PublicRateLimitGuard,
      { provide: DataSource, useValue: AppDataSource },
      { provide: ConfigService, useValue: config },
      { provide: RedisService, useValue: redis },
      { provide: NotificationsService, useValue: notificationsService },
      { provide: FaceProfileService, useValue: faceProfiles },
      { provide: AuditLogsService, useValue: { logAction: async () => undefined } },
      { provide: UsersService, useValue: usersService },
      { provide: AlertsService, useValue: { recordAlert: async (a: Record<string, unknown>) => { alerts.push(a); return { isNew: true }; } } },
      { provide: VisitorDeviceSync, useValue: deviceSync },
      { provide: GateAccessLogService, useValue: new GateAccessLogService(AppDataSource.getRepository(GateAccessLogEntity), AppDataSource) },
      { provide: AuthzReadRepository, useValue: { getEffectiveRolesAndPermissions: async (id: string) => ({ roles: [], permissions: permissionsByUser.get(id) ?? [] }) } },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: { switchToHttp: () => { getRequest: () => { headers: Record<string, string>; user?: unknown } } }) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-test-user'];
        if (!id) throw new UnauthorizedException('Token not found');
        req.user = { userId: id };
        return true;
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return { app, notifications, alerts, deviceSync, counters, permissionsByUser, close: () => app.close() };
}

export { ValidationPipe };

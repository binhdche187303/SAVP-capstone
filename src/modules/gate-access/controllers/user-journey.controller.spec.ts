/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { UserJourneyController } from './user-journey.controller.js';
import { UserJourneyService } from '../services/user-journey.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('UserJourneyController (UJN-001)', () => {
  let controller: UserJourneyController;
  let serviceMock: any;

  // Dựng controller bằng `new` (mirror vehicle-registration.controller.spec.ts:30) —
  // KHÔNG qua Test.createTestingModule vì guard cần cả cây DI thật (JwtService,
  // RedisService...), trong khi ta chỉ cần kiểm metadata guard/permission.
  beforeEach(() => {
    serviceMock = {
      authorizeView: jest.fn().mockResolvedValue(undefined),
      getUserJourney: jest.fn().mockResolvedValue({
        userId: 'u1',
        fullName: 'Bui Van Long',
        date: '2026-07-29',
        events: [],
        gateCount: 0,
        meetingCount: 0,
        zoneCount: 0,
      }),
    };
    controller = new UserJourneyController(serviceMock);
  });

  afterEach(() => jest.clearAllMocks());

  const ADMIN = { userId: 'admin-1' };

  it('kiểm phạm vi + ghi audit TRƯỚC khi đọc hành trình', async () => {
    await controller.userJourney({ userId: 'u1', date: '2026-07-29' }, ADMIN);
    expect(serviceMock.authorizeView).toHaveBeenCalledWith('admin-1', 'u1', '2026-07-29');
  });

  it('authorizeView ném 403 ⇒ không đọc dữ liệu', async () => {
    serviceMock.authorizeView.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(controller.userJourney({ userId: 'u2' }, ADMIN)).rejects.toThrow('Forbidden');
    expect(serviceMock.getUserJourney).not.toHaveBeenCalled();
  });

  it('trả envelope chuẩn {success, message, data}', async () => {
    const r = await controller.userJourney({
      userId: 'u1',
      date: '2026-07-29',
    }, ADMIN);
    expect(r.success).toBe(true);
    expect(r.message).toBe('User journey retrieved');
    expect(r.data.fullName).toBe('Bui Van Long');
    expect(serviceMock.getUserJourney).toHaveBeenCalledWith('u1', '2026-07-29');
  });

  it('truyền date=undefined khi client không gửi (service tự lấy hôm nay giờ VN)', async () => {
    await controller.userJourney({ userId: 'u1' }, ADMIN);
    expect(serviceMock.getUserJourney).toHaveBeenCalledWith('u1', undefined);
  });

  // ── Permission: user thiếu quyền sẽ bị PermissionsGuard chặn (403) ──
  it('admin-gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions(zones.gate_log.read)', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.userJourney) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);

    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.userJourney);
    // Quyền này ĐÃ seed cho BUSINESS_ADMIN + MANAGER + SYSTEM_ADMIN (kiểm role_permissions
    // trên DB thật). KHÔNG dùng gate_access.* vì chưa chắc có ở mọi môi trường ⇒ tránh 403.
    expect(perms).toEqual(['zones.gate_log.read']);
  });

  // ── [2026-08-21] Route "own" — bất kỳ user login nào cũng xem hành trình ĐẦY ĐỦ của mình ──
  describe('myJourney (GET /campus/user-journey/me)', () => {
    it('gọi service với userId lấy từ CurrentUser (JWT), KHÔNG phải query', async () => {
      const r = await controller.myJourney(
        { userId: 'self-1' },
        { date: '2026-08-21' },
      );
      expect(r.success).toBe(true);
      expect(serviceMock.getUserJourney).toHaveBeenCalledWith(
        'self-1',
        '2026-08-21',
      );
    });

    it('chỉ gate JwtAuthGuard — KHÔNG có PermissionsGuard/RequirePermissions (self-scoped, không cần quyền)', () => {
      const guards =
        Reflect.getMetadata('__guards__', controller.myJourney) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(PermissionsGuard);

      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.myJourney);
      expect(perms).toBeUndefined();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthController } from '../../src/modules/auth/controllers/auth.controller';
import { LogoutService } from '../../src/modules/auth/services/logout.service';
import { AuthConfigService } from '../../src/modules/auth/services/auth-config.service';
import { AuthAuditRepository } from '../../src/modules/auth/repositories/auth-audit.repository';
import { LoginService } from '../../src/modules/auth/services/login.service';
import { LoginResponsePresenter } from '../../src/modules/auth/presenters/login-response.presenter';
import { PasswordResetService } from '../../src/modules/auth/services/password-reset.service';
import { ChangePasswordService } from '../../src/modules/auth/services/change-password.service';
import { GetMeService } from '../../src/modules/auth/services/get-me.service';
import { RefreshTokenService } from '../../src/modules/auth/services/refresh-token.service';
import { RedisService } from '../../src/modules/redis/redis.service';

/**
 * Logout: controller + LogoutService + JwtAuthGuard thật; Redis là bộ nhớ trong để kiểm tra blacklist.
 * Route logout có `ignoreBlacklist` nên gọi lại bằng chính token đó vẫn 200 (idempotent),
 * còn route khác (GET /auth/me) phải từ chối token đã thu hồi.
 */
describe('Logout (e2e)', () => {
  const SECRET = 'logout-e2e-secret';
  let app: INestApplication;
  let jwtService: JwtService;
  const store = new Map<string, { value: string; ttl?: number }>();
  const audit = { logLogoutSuccess: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AuthController],
      providers: [
        LogoutService,
        { provide: AuthConfigService, useValue: { getAccessTokenSecret: () => SECRET } },
        {
          provide: RedisService,
          useValue: {
            setWithTtl: async (key: string, value: string, ttl: number) => { store.set(key, { value, ttl }); },
            exists: async (key: string) => store.has(key),
            get: async (key: string) => store.get(key)?.value ?? null,
          },
        },
        { provide: AuthAuditRepository, useValue: audit },
        { provide: GetMeService, useValue: { getMe: async (userId: string) => ({ userId }) } },
        { provide: LoginService, useValue: {} },
        { provide: LoginResponsePresenter, useValue: {} },
        { provide: PasswordResetService, useValue: {} },
        { provide: ChangePasswordService, useValue: {} },
        { provide: RefreshTokenService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/logout: thu hồi token, gọi lại vẫn 200 (idempotent), token không dùng được ở route khác', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1', jti: 'jti-123' }, { secret: SECRET, expiresIn: '1h' });

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);

    const res = await request(app.getHttpServer()).post('/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.revoked).toBe(true);
    const entry = store.get('blacklist:jti-123');
    expect(entry?.value).toBe('1');
    expect(entry?.ttl).toBeGreaterThan(3500); // TTL theo exp còn lại của token (~1h)
    expect(audit.logLogoutSuccess).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', jti: 'jti-123' }));

    await request(app.getHttpServer()).post('/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);

    const after = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    expect(JSON.stringify(after.body)).toContain('Token has been revoked');
  });

  it('POST /auth/logout không có token → 401', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(401);
  });
});

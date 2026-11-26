import { INestApplication, Provider, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/modules/auth/controllers/auth.controller';
import { LoginResponsePresenter } from '../../src/modules/auth/presenters/login-response.presenter';
import { ResetAuditRepository } from '../../src/modules/auth/repositories/reset-audit.repository';
import { UsersResetRepository } from '../../src/modules/auth/repositories/users-reset.repository';
import { AuthConfigService } from '../../src/modules/auth/services/auth-config.service';
import { AuthEmailService } from '../../src/modules/auth/services/auth-email.service';
import { ChangePasswordService } from '../../src/modules/auth/services/change-password.service';
import { GetMeService } from '../../src/modules/auth/services/get-me.service';
import { LoginService } from '../../src/modules/auth/services/login.service';
import { LogoutService } from '../../src/modules/auth/services/logout.service';
import { PasswordResetCacheService } from '../../src/modules/auth/services/password-reset-cache.service';
import { PasswordResetService } from '../../src/modules/auth/services/password-reset.service';
import { RefreshTokenService } from '../../src/modules/auth/services/refresh-token.service';
import { RedisService } from '../../src/modules/redis/redis.service';

/** Mọi method trả về jest.fn() đã resolve undefined — dùng cho phụ thuộc mà test không quan tâm. */
export const autoMock = <T extends object>(): T =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'then') return undefined; // không bị coi là Promise
      if (!(key in target)) target[key] = jest.fn().mockResolvedValue(undefined);
      return target[key];
    },
  }) as T;

/**
 * App chỉ gồm AuthController + PasswordResetService THẬT; repository/cache/email truyền mock vào.
 * Trước đây các e2e password-reset boot nguyên AppModule rồi mock cả TypeORM — không còn chạy được.
 */
export async function createPasswordResetApp(mocks: {
  usersRepository: object;
  cacheService: object;
  emailService?: object;
  auditRepository?: object;
}): Promise<INestApplication> {
  const providers: Provider[] = [
    PasswordResetService,
    { provide: UsersResetRepository, useValue: mocks.usersRepository },
    { provide: PasswordResetCacheService, useValue: mocks.cacheService },
    { provide: AuthEmailService, useValue: mocks.emailService ?? autoMock() },
    { provide: ResetAuditRepository, useValue: mocks.auditRepository ?? autoMock() },
    { provide: AuthConfigService, useValue: { getAccessTokenSecret: () => 'password-reset-e2e' } },
    { provide: RedisService, useValue: autoMock() },
    ...[LoginService, LogoutService, LoginResponsePresenter, ChangePasswordService, GetMeService, RefreshTokenService].map(
      (provide) => ({ provide, useValue: autoMock() }),
    ),
  ];
  const moduleFixture = await Test.createTestingModule({
    imports: [JwtModule.register({})],
    controllers: [AuthController],
    providers,
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

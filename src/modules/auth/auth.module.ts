import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './controllers/auth.controller';
import { LoginResponsePresenter } from './presenters/login-response.presenter';
import { AuthAuditRepository } from './repositories/auth-audit.repository';
import { AuthzReadRepository } from './repositories/authz-read.repository';
import { UsersAuthRepository } from './repositories/users-auth.repository';
import { BiometricStatusRawRepository } from './repositories/biometric-status-raw.repository';
import { UsersResetRepository } from './repositories/users-reset.repository';
import { ResetAuditRepository } from './repositories/reset-audit.repository';
import { UsersChangePasswordRepository } from './repositories/users-change-password.repository';
import { ChangePasswordAuditRepository } from './repositories/change-password-audit.repository';
import { AuthConfigService } from './services/auth-config.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { RateLimitService } from './services/rate-limit.service';
import { TokenService } from './services/token.service';
import { PasswordResetCacheService } from './services/password-reset-cache.service';
import { AuthEmailService } from './services/auth-email.service';
import { PasswordResetService } from './services/password-reset.service';
import { ChangePasswordCacheService } from './services/change-password-cache.service';
import { ChangePasswordService } from './services/change-password.service';
import { MustChangePasswordGuard } from './guards/must-change-password.guard';
import { BiometricEnforcementGuard } from './guards/biometric-enforcement.guard';
import { PartnerAccountRestrictionGuard } from './guards/partner-account-restriction.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { GetMeService } from './services/get-me.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { UelSsoController } from './sso/uel-sso.controller';
import { UelSsoService } from './sso/uel-sso.service';
import { UelSsoStateStore } from './sso/uel-sso-state.store';
import { UelSsoAccountRepository } from './sso/uel-sso-account.repository';
import { UelSsoClient } from './sso/uel-sso.client';
import { UelKeycloakClient } from './sso/uel-sso-keycloak.client';
import {
  readUelSsoSettings,
  UEL_SSO_CLIENT,
  UEL_SSO_KEYCLOAK_CLIENT,
  UEL_SSO_SETTINGS,
  type UelSsoSettings,
} from './sso/uel-sso.config';

@Module({
  imports: [JwtModule.register({}), CacheModule.register()],
  controllers: [AuthController, UelSsoController],
  providers: [
    AuthConfigService,
    RateLimitService,
    TokenService,
    LoginService,
    LogoutService,
    LoginResponsePresenter,
    UsersAuthRepository,
    BiometricStatusRawRepository,
    AuthzReadRepository,
    AuthAuditRepository,
    UsersResetRepository,
    ResetAuditRepository,
    PasswordResetCacheService,
    AuthEmailService,
    PasswordResetService,
    // UC-AUTH-04: Change Password
    UsersChangePasswordRepository,
    ChangePasswordAuditRepository,
    ChangePasswordCacheService,
    ChangePasswordService,
    MustChangePasswordGuard,
    BiometricEnforcementGuard,
    PartnerAccountRestrictionGuard,
    // Guards exported for use in other modules (MeetingsModule, AccountsModule, etc.)
    JwtAuthGuard,
    PermissionsGuard,
    RolesGuard,
    GetMeService,
    RefreshTokenService,
    // Đăng nhập một lần UEL (PSC API hoặc thẳng Keycloak — UEL_SSO_MODE) — cấu hình UEL_SSO_* trong .env
    {
      provide: UEL_SSO_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => readUelSsoSettings(config),
    },
    {
      provide: UEL_SSO_CLIENT,
      inject: [UEL_SSO_SETTINGS],
      useFactory: (s: UelSsoSettings) =>
        new UelSsoClient({
          baseUrl: s.baseUrl,
          clientId: s.clientId,
          clientSecret: s.clientSecret,
          timeoutMs: s.timeoutMs,
        }),
    },
    {
      provide: UEL_SSO_KEYCLOAK_CLIENT,
      inject: [UEL_SSO_SETTINGS],
      useFactory: (s: UelSsoSettings) =>
        new UelKeycloakClient({
          realmUrl: s.baseUrl,
          clientId: s.clientId,
          clientSecret: s.clientSecret,
          timeoutMs: s.timeoutMs,
        }),
    },
    UelSsoStateStore,
    UelSsoAccountRepository,
    UelSsoService,
  ],
  exports: [
    // Re-export JwtModule and CacheModule so importing modules can resolve
    // JwtService and CACHE_MANAGER (required by JwtAuthGuard)
    JwtModule,
    CacheModule,
    AuthConfigService,
    RateLimitService,
    TokenService,
    LoginService,
    LogoutService,
    UsersAuthRepository,
    BiometricStatusRawRepository,
    AuthzReadRepository,
    AuthAuditRepository,
    UsersResetRepository,
    ResetAuditRepository,
    PasswordResetCacheService,
    AuthEmailService,
    PasswordResetService,
    // UC-AUTH-04: Change Password — exported for potential use in other modules
    UsersChangePasswordRepository,
    ChangePasswordAuditRepository,
    ChangePasswordCacheService,
    ChangePasswordService,
    MustChangePasswordGuard,
    BiometricEnforcementGuard,
    PartnerAccountRestrictionGuard,
    // Guards exported for use in other modules
    JwtAuthGuard,
    PermissionsGuard,
    RolesGuard,
    GetMeService,
  ],
})
export class AuthModule {}

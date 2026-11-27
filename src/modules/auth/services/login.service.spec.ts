import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { BiometricStatusRawRepository } from '../repositories/biometric-status-raw.repository';
import { LoginService } from './login.service';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';
import { AuthConfigService } from './auth-config.service';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('LoginService', () => {
  const usersAuthRepository = {
    findByNormalizedEmail: jest.fn(),
    updateLastLoginAt: jest.fn(),
  } as unknown as UsersAuthRepository;
  const authzReadRepository = {
    getEffectiveRolesAndPermissions: jest.fn(),
  } as unknown as AuthzReadRepository;
  const authAuditRepository = {
    logLoginSuccess: jest.fn(),
  } as unknown as AuthAuditRepository;
  const rateLimitService = {
    checkOrThrow: jest.fn(),
    assertAllowed: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  } as unknown as RateLimitService;
  const tokenService = {
    generateAccessToken: jest.fn(),
    generateRefreshToken: jest.fn(),
    hashRefreshToken: jest.fn(() => 'hashed-refresh'),
  } as unknown as TokenService;
  const authConfigService = {
    getRefreshTokenTtlSeconds: jest.fn(() => 604800),
    getAccessTokenTtlSeconds: jest.fn(() => 3600),
  } as unknown as AuthConfigService;
  const biometricStatusRawRepository = {
    getFaceProfileRows: jest.fn(),
  } as unknown as BiometricStatusRawRepository;

  const service = new LoginService(
    usersAuthRepository,
    authzReadRepository,
    authAuditRepository,
    rateLimitService,
    tokenService,
    authConfigService,
    biometricStatusRawRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (rateLimitService.assertAllowed as jest.Mock).mockImplementation(
      () => undefined,
    );
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([]);
  });

  /** Mock thành công đầy đủ để chạy tới bước build summary. */
  const mockActiveLogin = () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      passwordHash: 'hash',
      fullName: 'User',
      avatarUrl: null,
      departmentId: null,
      accountStatus: 'active',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (tokenService.generateAccessToken as jest.Mock).mockResolvedValue('access');
    (tokenService.generateRefreshToken as jest.Mock).mockResolvedValue(
      'refresh',
    );
    (
      authzReadRepository.getEffectiveRolesAndPermissions as jest.Mock
    ).mockResolvedValue({ roles: ['INTERNAL_USER'], permissions: [] });
    (usersAuthRepository.updateLastLoginAt as jest.Mock).mockResolvedValue(
      undefined,
    );
    (authAuditRepository.logLoginSuccess as jest.Mock).mockResolvedValue(
      undefined,
    );
  };

  it('throws AUTH_INVALID_CREDENTIALS when user not found', async () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue(
      null,
    );

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_INVALID_CREDENTIALS',
      },
      status: 401,
    });
  });

  it('throws AUTH_TOO_MANY_ATTEMPTS when rate limit exceeded', async () => {
    (rateLimitService.assertAllowed as jest.Mock).mockImplementation(() => {
      const error = new Error('AUTH_TOO_MANY_ATTEMPTS');
      error.name = 'AUTH_TOO_MANY_ATTEMPTS';
      throw error;
    });

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_TOO_MANY_ATTEMPTS',
      },
      status: 429,
    });
  });

  it('throws AUTH_ACCOUNT_INACTIVE when status inactive', async () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      passwordHash: 'hash',
      fullName: 'User',
      avatarUrl: null,
      departmentId: null,
      accountStatus: 'inactive',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_ACCOUNT_INACTIVE',
      },
      status: 403,
    });
  });

  it('throws AUTH_TOKEN_GENERATION_FAILED when token generation fails', async () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      passwordHash: 'hash',
      fullName: 'User',
      avatarUrl: null,
      departmentId: null,
      accountStatus: 'active',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (tokenService.generateAccessToken as jest.Mock).mockRejectedValue(
      new Error('token generation failed'),
    );

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_TOKEN_GENERATION_FAILED',
      },
      status: 500,
    });
  });

  // ── ACCT-BIOMETRIC-SUBMIT-001 (BR-016): biometric fields trong login response ──

  it('login response chứa biometricReviewStatus=approved khi user có row active (AC-006)', async () => {
    mockActiveLogin();
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.biometricReviewStatus).toBe('approved');
    expect(result.user.biometricRequired).toBe(false);
    expect(result.user.shouldShowBiometricPopup).toBe(false);
  });

  it('login response chứa biometricReviewStatus=not_uploaded khi user chưa có row (AC-001)', async () => {
    mockActiveLogin();
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.biometricReviewStatus).toBe('not_uploaded');
    expect(result.user.shouldShowBiometricPopup).toBe(true);
  });

  it('login response chứa biometricReviewStatus=rejected khi user có row rejected (AC-004)', async () => {
    mockActiveLogin();
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.biometricReviewStatus).toBe('rejected');
    expect(result.user.shouldShowBiometricPopup).toBe(true);
  });

  it('login KHÔNG fail khi đọc biometric status lỗi → fallback not_uploaded (resilience)', async () => {
    mockActiveLogin();
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockRejectedValue(new Error('db down'));

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.accessToken).toBe('access');
    expect(result.user.biometricReviewStatus).toBe('not_uploaded');
  });

  it('BUSINESS_ADMIN → biometricRequired=false dù chưa upload (BA 2026-08-03)', async () => {
    mockActiveLogin();
    (
      authzReadRepository.getEffectiveRolesAndPermissions as jest.Mock
    ).mockResolvedValue({ roles: ['BUSINESS_ADMIN'], permissions: [] });
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.biometricRequired).toBe(false);
    expect(result.user.shouldShowBiometricPopup).toBe(false);
  });

  it('SYSTEM_ADMIN → biometricRequired=false dù có ảnh rejected (BA 2026-08-03)', async () => {
    mockActiveLogin();
    (
      authzReadRepository.getEffectiveRolesAndPermissions as jest.Mock
    ).mockResolvedValue({ roles: ['SYSTEM_ADMIN'], permissions: [] });
    (
      biometricStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.biometricRequired).toBe(false);
    expect(result.user.shouldShowBiometricPopup).toBe(false);
  });

  describe('PTA account expiry in LoginService', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (rateLimitService.assertAllowed as jest.Mock).mockImplementation(
        () => undefined,
      );
      (
        biometricStatusRawRepository.getFaceProfileRows as jest.Mock
      ).mockResolvedValue([]);
    });

    const mockUser = (accountExpiresAt: Date | null) =>
      (
        usersAuthRepository.findByNormalizedEmail as jest.Mock
      ).mockResolvedValue({
        id: 'partner-1',
        email: 'partner@example.com',
        passwordHash: 'hash',
        fullName: 'Partner',
        avatarUrl: null,
        departmentId: null,
        accountStatus: 'active',
        accountExpiresAt,
      });

    it('allows login when account_expires_at is null', async () => {
      mockUser(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (tokenService.generateAccessToken as jest.Mock).mockResolvedValue(
        'access',
      );
      (tokenService.generateRefreshToken as jest.Mock).mockResolvedValue(
        'refresh',
      );
      (
        authzReadRepository.getEffectiveRolesAndPermissions as jest.Mock
      ).mockResolvedValue({ roles: ['EMPLOYEE'], permissions: [] });
      (usersAuthRepository.updateLastLoginAt as jest.Mock).mockResolvedValue(
        undefined,
      );
      (authAuditRepository.logLoginSuccess as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await service.login(
        { email: 'partner@example.com', password: 'x' },
        {},
      );
      expect(result.accessToken).toBe('access');
    });

    it('allows login before expiry', async () => {
      mockUser(new Date(Date.now() + 86400000));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (tokenService.generateAccessToken as jest.Mock).mockResolvedValue(
        'access',
      );
      (tokenService.generateRefreshToken as jest.Mock).mockResolvedValue(
        'refresh',
      );
      (
        authzReadRepository.getEffectiveRolesAndPermissions as jest.Mock
      ).mockResolvedValue({ roles: ['EMPLOYEE'], permissions: [] });
      (usersAuthRepository.updateLastLoginAt as jest.Mock).mockResolvedValue(
        undefined,
      );
      (authAuditRepository.logLoginSuccess as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await service.login(
        { email: 'partner@example.com', password: 'x' },
        {},
      );
      expect(result.accessToken).toBe('access');
    });

    it('blocks login after expiry with AUTH_ACCOUNT_EXPIRED', async () => {
      mockUser(new Date(Date.now() - 1000));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ email: 'partner@example.com', password: 'x' }, {}),
      ).rejects.toMatchObject({
        response: { code: 'AUTH_ACCOUNT_EXPIRED' },
        status: 403,
      });
    });
  });
});

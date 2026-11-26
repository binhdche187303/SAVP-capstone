import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { createPasswordResetApp } from './support/auth-controller-app';
import { UsersResetRepository } from '../src/modules/auth/repositories/users-reset.repository';
import { PasswordResetCacheService } from '../src/modules/auth/services/password-reset-cache.service';

describe('Password Reset Confirm (e2e)', () => {
  let app: INestApplication<App>;
  let mockUsersRepository: any;
  let mockCacheService: any;

  beforeEach(async () => {
    mockUsersRepository = {
      findByEmailForReset: jest.fn(),
      updatePasswordInTransaction: jest.fn().mockResolvedValue(undefined),
    };

    mockCacheService = {
      getOtpSession: jest.fn(),
      setOtpSession: jest.fn().mockResolvedValue(undefined),
      deleteOtpSession: jest.fn().mockResolvedValue(undefined),
      deleteLimitCounter: jest.fn().mockResolvedValue(undefined),
      deleteBlockKey: jest.fn().mockResolvedValue(undefined),
      invalidateUserTokens: jest.fn().mockResolvedValue(undefined),
    };

    app = (await createPasswordResetApp({ usersRepository: mockUsersRepository, cacheService: mockCacheService })) as INestApplication<App>;
  });

  afterEach(async () => {
    await app.close();
  });

  it('resets password successfully when email, OTP, and complexity are valid', async () => {
    const email = 'user@example.com';
    const otp = '123456';
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    mockUsersRepository.findByEmailForReset.mockResolvedValue({
      id: 'user-id',
      email,
      passwordHash: 'oldhash',
      accountStatus: 'active',
      employmentStatus: 'active',
      deletedAt: null,
    });

    mockCacheService.getOtpSession.mockResolvedValue({
      otpHash: hashedOtp,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({
        email,
        otp,
        newPassword: 'StrongPassword123!',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('Đặt lại mật khẩu thành công');
  });

  it('returns HTTP 400 with AUTH_OTP_INVALID_OR_EXPIRED if OTP is incorrect', async () => {
    const email = 'user@example.com';
    const otp = '123456';
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    mockUsersRepository.findByEmailForReset.mockResolvedValue({
      id: 'user-id',
      email,
      passwordHash: 'oldhash',
      accountStatus: 'active',
      employmentStatus: 'active',
      deletedAt: null,
    });

    mockCacheService.getOtpSession.mockResolvedValue({
      otpHash: hashedOtp,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({
        email,
        otp: '000000', // Bad OTP
        newPassword: 'StrongPassword123!',
      })
      .expect(400);

    expect(response.body.error.code).toBe('AUTH_OTP_INVALID_OR_EXPIRED');
  });

  it('returns HTTP 400 for password that is too weak', async () => {
    const email = 'user@example.com';
    const otp = '123456';

    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({
        email,
        otp,
        newPassword: 'weak', // weak password
      })
      .expect(400);

    // Express/ValidationPipe throws BadRequest for DTO violation
    expect(response.body.statusCode).toBe(400);
  });
});

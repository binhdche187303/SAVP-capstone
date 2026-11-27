import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetCacheService } from './password-reset-cache.service';
import { AuthEmailService } from './auth-email.service';
import { UsersResetRepository } from '../repositories/users-reset.repository';
import { ResetAuditRepository } from '../repositories/reset-audit.repository';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let cacheService: {
    isBlocked: jest.Mock;
    incrementLimitCounter: jest.Mock;
    blockEmail: jest.Mock;
    getOtpSession: jest.Mock;
    setOtpSession: jest.Mock;
    deleteOtpSession: jest.Mock;
    deleteLimitCounter: jest.Mock;
    deleteBlockKey: jest.Mock;
    invalidateUserTokens: jest.Mock;
  };
  let emailService: {
    sendOtp: jest.Mock;
  };
  let usersRepository: {
    findByEmailForReset: jest.Mock;
    updatePasswordInTransaction: jest.Mock;
  };
  let auditRepository: {
    logOtpRequest: jest.Mock;
    logResetSuccess: jest.Mock;
  };

  beforeEach(async () => {
    cacheService = {
      isBlocked: jest.fn(),
      incrementLimitCounter: jest.fn(),
      blockEmail: jest.fn(),
      getOtpSession: jest.fn(),
      setOtpSession: jest.fn(),
      deleteOtpSession: jest.fn(),
      deleteLimitCounter: jest.fn(),
      deleteBlockKey: jest.fn(),
      invalidateUserTokens: jest.fn(),
    };

    emailService = {
      sendOtp: jest.fn().mockResolvedValue(undefined),
    };

    usersRepository = {
      findByEmailForReset: jest.fn(),
      updatePasswordInTransaction: jest.fn(),
    };

    auditRepository = {
      logOtpRequest: jest.fn().mockResolvedValue(undefined),
      logResetSuccess: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PasswordResetCacheService, useValue: cacheService },
        { provide: AuthEmailService, useValue: emailService },
        { provide: UsersResetRepository, useValue: usersRepository },
        { provide: ResetAuditRepository, useValue: auditRepository },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);
  });

  describe('requestOtp', () => {
    const email = 'user@example.com';
    const dto = { email };

    it('should successfully send OTP if account is active and not rate-limited', async () => {
      cacheService.isBlocked.mockResolvedValue(false);
      cacheService.incrementLimitCounter.mockResolvedValue(1);
      usersRepository.findByEmailForReset.mockResolvedValue({
        id: 'user-id',
        email,
        passwordHash: 'hash',
        accountStatus: 'active',
        employmentStatus: 'active',
        deletedAt: null,
      });

      const result = await service.requestOtp(dto);

      expect(result.success).toBe(true);
      expect(result.message).toContain('mã xác thực đã được gửi');
      expect(cacheService.setOtpSession).toHaveBeenCalled();
      expect(emailService.sendOtp).toHaveBeenCalled();
    });

    it('should throw HTTP 429 if email is already blocked', async () => {
      cacheService.isBlocked.mockResolvedValue(true);

      await expect(service.requestOtp(dto)).rejects.toThrow(HttpException);
      await expect(service.requestOtp(dto)).rejects.toThrow(
        'Yêu cầu quá nhiều lần. Vui lòng thử lại sau.',
      );
    });

    it('should block email and throw HTTP 429 if rate limit is exceeded', async () => {
      cacheService.isBlocked.mockResolvedValue(false);
      cacheService.incrementLimitCounter.mockResolvedValue(4); // Exceeds 3 attempts

      await expect(service.requestOtp(dto)).rejects.toThrow(HttpException);
      expect(cacheService.blockEmail).toHaveBeenCalledWith(email, 3600000);
    });

    it('email không tồn tại → trả Y HỆT phản hồi thành công nhưng KHÔNG tạo/gửi mã (chống dò tài khoản)', async () => {
      cacheService.isBlocked.mockResolvedValue(false);
      cacheService.incrementLimitCounter.mockResolvedValue(1);
      usersRepository.findByEmailForReset.mockResolvedValue(null);

      const result = await service.requestOtp(dto);
      expect(result.success).toBe(true);
      expect(result.message).toContain('mã xác thực đã được gửi');
      expect(cacheService.setOtpSession).not.toHaveBeenCalled();
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });

    it('should return unified E1 error if user is restricted (locked/resigned/soft deleted)', async () => {
      cacheService.isBlocked.mockResolvedValue(false);
      cacheService.incrementLimitCounter.mockResolvedValue(1);

      const restrictedUsers = [
        {
          accountStatus: 'locked',
          employmentStatus: 'active',
          deletedAt: null,
        },
        {
          accountStatus: 'active',
          employmentStatus: 'resigned',
          deletedAt: null,
        },
        {
          accountStatus: 'active',
          employmentStatus: 'active',
          deletedAt: new Date(),
        },
      ];

      for (const restrictedUser of restrictedUsers) {
        usersRepository.findByEmailForReset.mockResolvedValue({
          id: 'user-id',
          email,
          passwordHash: 'hash',
          ...restrictedUser,
        });

        const result = await service.requestOtp(dto);
        expect(result.success).toBe(true);
      }
      expect(cacheService.setOtpSession).not.toHaveBeenCalled();
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('confirmReset', () => {
    const email = 'user@example.com';
    const rawOtp = '123456';
    const hashedOtp = crypto.createHash('sha256').update(rawOtp).digest('hex');
    const newPassword = 'NewPassword123!';
    const dto = { email, otp: rawOtp, newPassword };

    it('should reset password successfully when OTP is correct', async () => {
      usersRepository.findByEmailForReset.mockResolvedValue({
        id: 'user-id',
        email,
        passwordHash: 'oldhash',
        accountStatus: 'active',
        employmentStatus: 'active',
        deletedAt: null,
      });

      cacheService.getOtpSession.mockResolvedValue({
        otpHash: hashedOtp,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });

      const result = await service.confirmReset(dto);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Đặt lại mật khẩu thành công');
      expect(usersRepository.updatePasswordInTransaction).toHaveBeenCalledWith(
        'user-id',
        expect.any(String),
      );
      expect(cacheService.deleteOtpSession).toHaveBeenCalledWith(email);
      expect(cacheService.deleteLimitCounter).toHaveBeenCalledWith(email);
      expect(cacheService.deleteBlockKey).toHaveBeenCalledWith(email);
    });

    it('should throw unified E1 if account is restricted during confirm reset', async () => {
      usersRepository.findByEmailForReset.mockResolvedValue(null);

      await expect(service.confirmReset(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw E2 if OTP session is expired or not found', async () => {
      usersRepository.findByEmailForReset.mockResolvedValue({
        id: 'user-id',
        email,
        passwordHash: 'oldhash',
        accountStatus: 'active',
        employmentStatus: 'active',
        deletedAt: null,
      });

      cacheService.getOtpSession.mockResolvedValue(null);

      await expect(service.confirmReset(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirmReset(dto)).rejects.toThrow(
        'Mã xác thực không hợp lệ hoặc đã hết hạn.',
      );
    });

    it('should increment failed attempts and throw E2 if OTP is incorrect', async () => {
      usersRepository.findByEmailForReset.mockResolvedValue({
        id: 'user-id',
        email,
        passwordHash: 'oldhash',
        accountStatus: 'active',
        employmentStatus: 'active',
        deletedAt: null,
      });

      cacheService.getOtpSession.mockResolvedValue({
        otpHash: hashedOtp,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });

      const badDto = { ...dto, otp: '000000' };

      await expect(service.confirmReset(badDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(cacheService.setOtpSession).toHaveBeenCalledWith(
        email,
        expect.objectContaining({ attempts: 1 }),
        expect.any(Number),
      );
    });

    it('should delete OTP session (self-destruct) and throw E2 if failed attempts reach 5', async () => {
      usersRepository.findByEmailForReset.mockResolvedValue({
        id: 'user-id',
        email,
        passwordHash: 'oldhash',
        accountStatus: 'active',
        employmentStatus: 'active',
        deletedAt: null,
      });

      cacheService.getOtpSession.mockResolvedValue({
        otpHash: hashedOtp,
        attempts: 4, // 5th failure
        createdAt: new Date().toISOString(),
      });

      const badDto = { ...dto, otp: '000000' };

      await expect(service.confirmReset(badDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(cacheService.deleteOtpSession).toHaveBeenCalledWith(email);
    });
  });
});

import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthEmailService } from './auth-email.service';
import { MailService } from '../../mail/mail.service';

describe('AuthEmailService', () => {
  let service: AuthEmailService;
  let mailService: { sendMail: jest.Mock };

  beforeEach(async () => {
    mailService = { sendMail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthEmailService,
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthEmailService>(AuthEmailService);
  });

  it('should send OTP email via MailService', async () => {
    mailService.sendMail.mockResolvedValue({
      success: true,
      messageId: 'mock-id',
    });

    await expect(
      service.sendOtp('user@example.com', '123456'),
    ).resolves.toBeUndefined();
    expect(mailService.sendMail).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: expect.stringContaining('Khoi phuc mat khau'),
      text: expect.stringContaining('123456'),
      html: expect.stringContaining('123456'),
    });
  });

  it('should throw AUTH_EMAIL_DISPATCH_FAILED when MailService returns failure', async () => {
    mailService.sendMail.mockResolvedValue({
      success: false,
      error: 'SMTP error',
    });

    await expect(service.sendOtp('user@example.com', '123456')).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(service.sendOtp('user@example.com', '123456')).rejects.toThrow(
      'AUTH_EMAIL_DISPATCH_FAILED',
    );
  });

  it('should throw AUTH_EMAIL_DISPATCH_FAILED for @error.com emails (simulated failure)', async () => {
    await expect(service.sendOtp('user@error.com', '123456')).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(service.sendOtp('user@error.com', '123456')).rejects.toThrow(
      'AUTH_EMAIL_DISPATCH_FAILED',
    );
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});

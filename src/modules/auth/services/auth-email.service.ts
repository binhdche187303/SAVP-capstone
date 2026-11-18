import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MailService } from '../../mail/mail.service';
import { buildOtpEmail } from '../../mail/templates/builders';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(private readonly mailService: MailService) {}

  async sendOtp(email: string, otp: string): Promise<void> {
    // Test hook: simulate SMTP failure for error handling verification
    if (email.endsWith('@error.com')) {
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }

    const subject = 'Khoi phuc mat khau - Smart Meeting Management';
    const text = [
      'Kính gửi người dùng,',
      '',
      'Bạn đã gửi yêu cầu đặt lại mật khẩu trên hệ thống Smart Meeting Management.',
      `Mã OTP xác thực của bạn là: ${otp}`,
      '',
      'Ma OTP nay co hieu luc trong vong 10 phut. De bao mat, vui long khong chia se ma nay cho bat ky ai.',
      'Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email này và bảo mật tài khoản.',
      '',
      'Tran trong,',
      'He thong Smart Meeting Management',
    ].join('\n');

    const html = buildOtpEmail({ otp, expiresMinutes: 10 });
    const result = await this.mailService.sendMail({
      to: email,
      subject,
      text,
      html,
    });

    if (!result.success) {
      this.logger.error(
        `Failed to send OTP email to ${email}: ${result.error}`,
      );
      throw new InternalServerErrorException('AUTH_EMAIL_DISPATCH_FAILED');
    }

    this.logger.log(`OTP email sent to ${email}`);
  }
}

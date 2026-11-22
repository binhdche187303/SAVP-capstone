import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevController } from './dev.controller.js';
import { MailModule } from '../mail/mail.module.js';
import { AnprModule } from '../anpr/anpr.module.js';
import { VisitorsModule } from '../visitors/visitors.module.js';
import { FaceAccessModule } from '../face-access/face-access.module.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * DevModule — Chỉ load khi NODE_ENV=development.
 *
 * Cung cấp các endpoint test utilities:
 * - POST /dev/test-mail — test SMTP connection
 *
 * KHÔNG được load ở production. Khi được nạp do MOCK_RECORDING_ENABLED (demo), mọi route vẫn
 * yêu cầu JWT — DevController gắn JwtAuthGuard ở cấp class.
 * KHÔNG expose bất kỳ secret/credential nào trong response.
 */
@Module({
  imports: [ConfigModule, AuthModule, MailModule, AnprModule, FaceAccessModule, VisitorsModule],
  controllers: [DevController],
})
export class DevModule {}

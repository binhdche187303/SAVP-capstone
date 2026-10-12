import { Global, Module } from '@nestjs/common';
import { VISITOR_FACE_EVENT_HOOK } from '../../common/ports/visitor-face-event-hook.js';
import { VisitorGateService } from './services/visitor-gate.service.js';
import { VisitorsModule } from './visitors.module.js';

/**
 * Cầu nối toàn cục: cung cấp token VISITOR_FACE_EVENT_HOOK cho ivss/face-access mà KHÔNG bắt chúng import
 * VisitorsModule (mẫu của face-access với FACE_VERIFY_HOOK).
 */
@Global()
@Module({
  imports: [VisitorsModule],
  providers: [{ provide: VISITOR_FACE_EVENT_HOOK, useExisting: VisitorGateService }],
  exports: [VISITOR_FACE_EVENT_HOOK],
})
export class VisitorHooksModule {}

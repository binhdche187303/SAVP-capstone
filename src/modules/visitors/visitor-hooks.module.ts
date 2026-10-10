import { Global, Module } from '@nestjs/common';
import { VISITOR_FACE_EVENT_HOOK } from '../../common/ports/visitor-face-event-hook.js';
import { VISITOR_REPORT_SOURCE } from '../../common/ports/visitor-report-source.js';
import { VisitQueryService } from './services/visit-query.service.js';
import { VisitorGateService } from './services/visitor-gate.service.js';
import { VisitorsModule } from './visitors.module.js';

/**
 * Cầu nối toàn cục: cung cấp token VISITOR_FACE_EVENT_HOOK cho ivss/face-access mà KHÔNG bắt chúng import
 * VisitorsModule (mẫu của face-access với FACE_VERIFY_HOOK). Cũng cung cấp VISITOR_REPORT_SOURCE cho Trung tâm báo cáo.
 */
@Global()
@Module({
  imports: [VisitorsModule],
  providers: [
    { provide: VISITOR_FACE_EVENT_HOOK, useExisting: VisitorGateService },
    // Trung tâm báo cáo lấy số liệu khách qua token này (ReportsModule không được import VisitorsModule — vòng qua AccountsModule).
    { provide: VISITOR_REPORT_SOURCE, useExisting: VisitQueryService },
  ],
  exports: [VISITOR_FACE_EVENT_HOOK, VISITOR_REPORT_SOURCE],
})
export class VisitorHooksModule {}

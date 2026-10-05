import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { VEHICLE_EVENT_HANDLER } from '../../../common/ports/vehicle-event-hook.js';
import type {
  VehicleEventHandlerPort,
  VehicleEvent,
} from '../../../common/ports/vehicle-event-hook.js';

/**
 * STT 7 (2026-10-05) — hàng đợi sự kiện xe. Webhook chỉ enqueue + ack ngay; worker này
 * chạy luồng xử lý CŨ (VehicleResolveService.onVehicleEvent) — KHÔNG đổi logic nghiệp vụ.
 *
 * Tên queue chung (không gắn "ivss"): nguồn khác (API camera mới) chỉ cần đẩy VehicleEvent
 * đã chuẩn hoá vào cùng queue.
 */
export const VEHICLE_EVENTS_QUEUE_NAME = 'vehicle-events';
export const VEHICLE_EVENT_JOB_NAME = 'vehicle-event';

/**
 * Giới hạn worker song song → ANPR chỉ chiếm tối đa N kết nối DB (pool mặc định 10),
 * phần còn lại phục vụ API khác. Gộp OCR vẫn đúng khi song song nhờ
 * pg_advisory_xact_lock theo channelId trong onVehicleEvent.
 */
const VEHICLE_EVENT_CONCURRENCY =
  Number(process.env.ANPR_QUEUE_CONCURRENCY) || 3;

@Processor(VEHICLE_EVENTS_QUEUE_NAME, {
  concurrency: VEHICLE_EVENT_CONCURRENCY,
})
export class VehicleEventProcessor extends WorkerHost {
  private readonly logger = new Logger(VehicleEventProcessor.name);

  constructor(
    @Inject(VEHICLE_EVENT_HANDLER)
    private readonly handler: VehicleEventHandlerPort,
  ) {
    super();
  }

  async process(job: Job<VehicleEvent>): Promise<void> {
    if (job.name !== VEHICLE_EVENT_JOB_NAME) {
      this.logger.warn(`Unknown job name=${job.name} - ACK`);
      return;
    }
    // onVehicleEvent tự nuốt lỗi nghiệp vụ (NotThrow). Ném ra ở đây chỉ khi lỗi bất ngờ
    // → BullMQ retry theo attempts mặc định.
    await this.handler.onVehicleEvent(job.data);
  }
}

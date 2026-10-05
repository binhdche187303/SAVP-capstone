import {
  Controller,
  Post,
  Body,
  Inject,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { VEHICLE_EVENT_HANDLER } from '../../../common/ports/vehicle-event-hook.js';
import type {
  VehicleEventHandlerPort,
  VehicleEvent,
} from '../../../common/ports/vehicle-event-hook.js';
import { VehicleEventDto } from '../dto/vehicle-event.dto.js';
import { AnprInternalTokenGuard } from '../guards/anpr-internal-token.guard.js';
import { normalizePlate } from '../utils/normalize-plate.js';
import {
  VEHICLE_EVENTS_QUEUE_NAME,
  VEHICLE_EVENT_JOB_NAME,
} from '../processors/vehicle-event.processor.js';

/**
 * VehicleWebhookController (VWH-001 / UC4) — nhận vehicle event từ IVSS bridge (system-to-system).
 *
 * SEC-01: AnprInternalTokenGuard (header X-Internal-Token = IVSS_BRIDGE_TOKEN), KHÔNG JWT.
 * ARCH-01: LUÔN ack 200 (try/catch quanh onVehicleEvent). DATA-01: normalize plateNumber qua
 * normalizePlate (UC1, single-source). UC4 KHÔNG resolve user / KHÔNG persist (UC5). KHÔNG log imageBase64.
 */
@ApiTags('ANPR - Webhook (internal, bridge)')
@Controller()
export class VehicleWebhookController {
  private readonly logger = new Logger(VehicleWebhookController.name);

  constructor(
    @Inject(VEHICLE_EVENT_HANDLER)
    private readonly handler: VehicleEventHandlerPort,
    @InjectQueue(VEHICLE_EVENTS_QUEUE_NAME)
    private readonly vehicleEventsQueue: Queue<VehicleEvent>,
  ) {}

  @Post('internal/ivss/vehicle-events')
  @HttpCode(200)
  @UseGuards(AnprInternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      '[NỘI BỘ — chỉ IVSS bridge gọi tới, không phải endpoint public] Nhận event nhận diện biển số xe từ camera ANPR, xác thực bằng header X-Internal-Token, luôn ack 200 kể cả khi xử lý event lỗi',
  })
  async receiveEvent(@Body() dto: VehicleEventDto) {
    // DATA-01: normalize single-source (UC1). Event mang cả plateRaw (gốc) + plateNumber (chuẩn).
    const event: VehicleEvent = {
      plateRaw: dto.plateNumber,
      plateNumber: normalizePlate(dto.plateNumber),
      channelId: dto.channelId,
      utc: dto.utc,
      eventAction: dto.eventAction,
      plateColor: dto.plateColor,
      vehicleColor: dto.vehicleColor,
      vehicleType: dto.vehicleType,
      imageBase64: dto.imageBase64,
    };

    // STT 7: enqueue rồi ack ngay — bridge không phải chờ xử lý DB. Redis lỗi → fallback
    // xử lý đồng bộ như cũ (không mất event).
    try {
      await this.vehicleEventsQueue.add(VEHICLE_EVENT_JOB_NAME, event);
      return {
        success: true,
        message: 'Vehicle event accepted',
        data: { accepted: true },
      };
    } catch (e) {
      this.logger.warn(
        `Vehicle event enqueue failed, xử lý đồng bộ (channel=${event.channelId} plate=${event.plateNumber}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }

    // ARCH-01: handoff best-effort — handler lỗi KHÔNG làm vỡ ack.
    try {
      await this.handler.onVehicleEvent(event);
    } catch (e) {
      // SEC-01: chỉ log metadata, KHÔNG imageBase64.
      this.logger.warn(
        `Vehicle event handler failed (channel=${event.channelId} plate=${event.plateNumber}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return {
      success: true,
      message: 'Vehicle event accepted',
      data: { accepted: true },
    };
  }
}

import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { HourlyRollup } from './zone-hourly-rollup.service.js';

/**
 * KPI-001 §4.2 — tổng hợp vehicle event (`iot_device_events`, event_type='ivss_vehicle_event')
 * theo giờ: số đếm theo (zone, loại xe, hướng, trạng thái khớp) + danh sách biển khác nhau.
 * Dùng index partial `IDX_iot_device_events_vehicle_time`.
 */
@Injectable()
export class VehicleHourlyRollupService implements HourlyRollup {
  async rollup(qr: QueryRunner, from: Date, to: Date): Promise<void> {
    await qr.query(
      `DELETE FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
      [from, to],
    );
    await qr.query(
      `INSERT INTO kpi_vehicle_hourly
         (bucket_hour, zone_id, vehicle_type, direction, match_state, event_count)
       SELECT date_trunc('hour', event_time, 'UTC'), zone_id,
              payload_json->>'vehicleType', payload_json->>'direction',
              payload_json->>'matchState', COUNT(*)
       FROM iot_device_events
       WHERE event_type = 'ivss_vehicle_event' AND event_time >= $1 AND event_time < $2
       GROUP BY 1, 2, 3, 4, 5`,
      [from, to],
    );
    await qr.query(
      `DELETE FROM kpi_vehicle_plate_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
      [from, to],
    );
    await qr.query(
      `INSERT INTO kpi_vehicle_plate_hourly (bucket_hour, zone_id, vehicle_type, plate_number)
       SELECT DISTINCT date_trunc('hour', event_time, 'UTC'), zone_id,
              payload_json->>'vehicleType', payload_json->>'plateNumber'
       FROM iot_device_events
       WHERE event_type = 'ivss_vehicle_event' AND event_time >= $1 AND event_time < $2
         AND payload_json->>'plateNumber' IS NOT NULL`,
      [from, to],
    );
  }
}

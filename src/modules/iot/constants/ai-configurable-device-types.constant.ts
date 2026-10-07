import { IoTDeviceType } from '../entities/iot-device.entity.js';

/**
 * AI_CONFIGURABLE_DEVICE_TYPES (IAC-001 / UC-96) — loại thiết bị cấu hình được chức năng AI
 * (bật/tắt nhận diện mặt / biển số / đếm người) qua `metadata_json.ai_config`.
 *
 * ⚠ TRÙNG danh sách VÀ tiêu chí với `ZONE_ASSIGNABLE_DEVICE_TYPES` của UC-94 (gán thiết bị vào
 * zone): "thiết bị SINH hoặc XỬ LÝ sự kiện AI theo vị trí". Một quy tắc, hai chỗ dùng —
 * `OCCUPANCY_SENSOR` (đếm người) và `FACE_SERVER` (nhận diện mặt) là thiết bị chính danh của
 * chức năng AI nên nằm trong danh sách; `MICROPHONE`/`CAPTURE_AGENT`/`DISPLAY` bị loại.
 */
export const AI_CONFIGURABLE_DEVICE_TYPES = [
  IoTDeviceType.IP_CAMERA,
  IoTDeviceType.DOOR_CAMERA,
  IoTDeviceType.ROOM_CAMERA,
  IoTDeviceType.ANPR_CAMERA,
  IoTDeviceType.OCCUPANCY_SENSOR,
  IoTDeviceType.FACE_SERVER,
] as const;

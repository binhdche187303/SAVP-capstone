import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigureAiConfigDto } from './configure-ai-config.dto.js';
import { AI_CONFIGURABLE_DEVICE_TYPES } from '../constants/ai-configurable-device-types.constant.js';
import { IoTDeviceType } from '../entities/iot-device.entity.js';

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(ConfigureAiConfigDto, body);
  return validate(dto);
};

const errOn = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
) => errors.find((e) => e.property === property)?.constraints;

describe('AI_CONFIGURABLE_DEVICE_TYPES (UC-96)', () => {
  it('đúng 6 loại (+ ANPR_CAMERA 2.2.1) (= allowlist UC-94), không MICROPHONE/CAPTURE_AGENT/DISPLAY', () => {
    expect([...AI_CONFIGURABLE_DEVICE_TYPES]).toEqual([
      IoTDeviceType.IP_CAMERA,
      IoTDeviceType.DOOR_CAMERA,
      IoTDeviceType.ROOM_CAMERA,
      IoTDeviceType.ANPR_CAMERA,
      IoTDeviceType.OCCUPANCY_SENSOR,
      IoTDeviceType.FACE_SERVER,
    ]);
    expect(AI_CONFIGURABLE_DEVICE_TYPES).not.toContain(
      IoTDeviceType.MICROPHONE,
    );
    expect(AI_CONFIGURABLE_DEVICE_TYPES).not.toContain(
      IoTDeviceType.CAPTURE_AGENT,
    );
    expect(AI_CONFIGURABLE_DEVICE_TYPES).not.toContain(IoTDeviceType.DISPLAY);
  });
});

describe('ConfigureAiConfigDto (UC-96)', () => {
  it('body rỗng {} → 0 lỗi (cả 3 optional)', async () => {
    expect(await validateBody({})).toHaveLength(0);
  });

  it('3 cờ boolean hợp lệ → 0 lỗi', async () => {
    expect(
      await validateBody({
        face_recognition: true,
        plate_recognition: false,
        people_counting: true,
      }),
    ).toHaveLength(0);
  });

  it('cờ không phải boolean → isBoolean', async () => {
    expect(
      errOn(await validateBody({ face_recognition: 'yes' }), 'faceRecognition'),
    ).toHaveProperty('isBoolean');
  });

  it('@Expose: snake_case → property camelCase', () => {
    const dto = plainToInstance(ConfigureAiConfigDto, {
      face_recognition: true,
      plate_recognition: false,
      people_counting: true,
    });
    expect(dto.faceRecognition).toBe(true);
    expect(dto.plateRecognition).toBe(false);
    expect(dto.peopleCounting).toBe(true);
  });

  it('whitelist: field lạ bị loại, cờ hợp lệ giữ', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    });
    const result = (await pipe.transform(
      { face_recognition: true, junk: 1 },
      { type: 'body', metatype: ConfigureAiConfigDto },
    )) as ConfigureAiConfigDto & Record<string, unknown>;
    expect(result).not.toHaveProperty('junk');
    expect(result.faceRecognition).toBe(true);
  });
});

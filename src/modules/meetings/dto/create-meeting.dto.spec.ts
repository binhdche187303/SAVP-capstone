beforeEach(() => jest.useFakeTimers({ now: new Date('2026-07-01T00:00:00Z') }));
afterEach(() => jest.useRealTimers());
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateMeetingDto } from './create-meeting.dto.js';

describe('CreateMeetingDto Validation', () => {
  describe('title', () => {
    it('should accept valid title', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp dự án',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      const titleErrors = errors.filter((e) => e.property === 'title');
      expect(titleErrors.length).toBe(0);
    });

    it('should reject empty title', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: '',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      const titleErrors = errors.filter((e) => e.property === 'title');
      expect(titleErrors.length).toBeGreaterThan(0);
    });
  });

  describe('startTime / endTime', () => {
    it('should reject invalid date format', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp',
        startTime: 'not-a-date',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('roomId', () => {
    it('should reject non-UUID roomId', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('participantUserIds', () => {
    it('should reject non-UUID in array', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        participantUserIds: ['not-a-uuid'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('externalParticipants', () => {
    it('should reject invalid email', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        externalParticipants: [{ fullName: 'John', email: 'invalid-email' }],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should accept valid external participant', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        externalParticipants: [
          { fullName: 'John Doe', email: 'john@example.com' },
        ],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('capacityOverrideConfirmed', () => {
    it('should accept boolean value', async () => {
      const dto = plainToInstance(CreateMeetingDto, {
        title: 'Họp',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        capacityOverrideConfirmed: true,
      });
      const errors = await validate(dto);
      const capErrors = errors.filter(
        (e) => e.property === 'capacityOverrideConfirmed',
      );
      expect(capErrors.length).toBe(0);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { EventsGateway } from './events.gateway';
import { AuthConfigService } from '../auth/services/auth-config.service';
import { GuestAccessConfigService } from '../guest-access/config/guest-access-config.service';
import { GuestAccessCacheService } from '../guest-access/services/guest-access-cache.service';
import { GuestAttendanceService } from '../guest-access/services/guest-attendance.service';
import { MeetingEntity } from '../meetings/entities/meeting.entity';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity';
import { AuthzReadRepository } from '../auth/repositories/authz-read.repository';

function buildSocket(auth: Record<string, unknown> = {}) {
  return {
    id: 'socket-1',
    handshake: { auth, query: {} },
    data: {} as { identity?: unknown },
    join: jest.fn(),
    leave: jest.fn(),
  } as any;
}

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let authConfigService: { getAccessTokenSecret: jest.Mock };
  let guestAccessConfigService: { getGuestTokenSecret: jest.Mock };
  let guestAccessCacheService: { isSessionRevoked: jest.Mock };
  let guestAttendanceService: { logLeave: jest.Mock };
  let meetingFindOne: jest.Mock;
  let participantFindOne: jest.Mock;
  let dataSource: { getRepository: jest.Mock };
  let authzRepo: { getEffectiveRolesAndPermissions: jest.Mock };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    authConfigService = {
      getAccessTokenSecret: jest.fn().mockReturnValue('employee-secret'),
    };
    guestAccessConfigService = {
      getGuestTokenSecret: jest.fn().mockReturnValue('guest-secret'),
    };
    guestAccessCacheService = {
      isSessionRevoked: jest.fn().mockResolvedValue(false),
    };
    guestAttendanceService = { logLeave: jest.fn() };
    meetingFindOne = jest.fn();
    participantFindOne = jest.fn();
    dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MeetingEntity) return { findOne: meetingFindOne };
        if (entity === MeetingParticipantEntity)
          return { findOne: participantFindOne };
        throw new Error('unexpected entity');
      }),
    };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: ['meeting_request.read'] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: JwtService, useValue: jwtService },
        { provide: AuthConfigService, useValue: authConfigService },
        {
          provide: GuestAccessConfigService,
          useValue: guestAccessConfigService,
        },
        { provide: GuestAccessCacheService, useValue: guestAccessCacheService },
        { provide: GuestAttendanceService, useValue: guestAttendanceService },
        { provide: DataSource, useValue: dataSource },
        { provide: AuthzReadRepository, useValue: authzRepo },
      ],
    }).compile();

    gateway = module.get(EventsGateway);
  });

  describe('handleConnection — identity resolution', () => {
    it('should leave identity null when no token is provided', async () => {
      const socket = buildSocket({});
      await gateway.handleConnection(socket);
      expect(socket.data.identity).toBeNull();
    });

    it('should resolve an employee identity for a valid employee token', async () => {
      jwtService.verifyAsync.mockResolvedValueOnce({ sub: 'user-1' });
      const socket = buildSocket({ token: 'employee-jwt' });
      await gateway.handleConnection(socket);
      expect(socket.data.identity).toEqual({
        type: 'employee',
        userId: 'user-1',
      });
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('employee-jwt', {
        secret: 'employee-secret',
      });
    });

    it('should fall back to guest identity when employee verify fails but guest verify succeeds', async () => {
      jwtService.verifyAsync
        .mockRejectedValueOnce(new Error('bad employee secret'))
        .mockResolvedValueOnce({
          typ: 'guest',
          sub: 'ep-1',
          mid: 'meeting-1',
          jti: 'jti-1',
        });
      const socket = buildSocket({ token: 'guest-jwt' });
      await gateway.handleConnection(socket);
      expect(socket.data.identity).toEqual({
        type: 'guest',
        externalParticipantId: 'ep-1',
        meetingId: 'meeting-1',
        jti: 'jti-1',
      });
    });

    it('should leave identity null for a revoked guest session', async () => {
      jwtService.verifyAsync
        .mockRejectedValueOnce(new Error('bad employee secret'))
        .mockResolvedValueOnce({
          typ: 'guest',
          sub: 'ep-1',
          mid: 'meeting-1',
          jti: 'jti-1',
        });
      guestAccessCacheService.isSessionRevoked.mockResolvedValue(true);
      const socket = buildSocket({ token: 'revoked-guest-jwt' });
      await gateway.handleConnection(socket);
      expect(socket.data.identity).toBeNull();
    });

    it('should leave identity null when both verifications fail (garbage token)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
      const socket = buildSocket({ token: 'garbage' });
      await gateway.handleConnection(socket);
      expect(socket.data.identity).toBeNull();
    });
  });

  describe('meeting:subscribe — the actual security gate (FR-GLA-036)', () => {
    it('should reject when there is no identity at all', async () => {
      const socket = buildSocket();
      socket.data.identity = null;
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '11111111-1111-1111-1111-111111111111' },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('should reject a guest whose token meetingId does not match the requested room (scope mismatch)', async () => {
      const socket = buildSocket();
      socket.data.identity = {
        type: 'guest',
        externalParticipantId: 'ep-1',
        meetingId: '11111111-1111-1111-1111-111111111111',
        jti: 'jti-1',
      };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '22222222-2222-2222-2222-222222222222' },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('should allow a guest whose token meetingId matches the requested room', async () => {
      const socket = buildSocket();
      socket.data.identity = {
        type: 'guest',
        externalParticipantId: 'ep-1',
        meetingId: '11111111-1111-1111-1111-111111111111',
        jti: 'jti-1',
      };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '11111111-1111-1111-1111-111111111111' },
        socket,
      );
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith(
        'meeting:11111111-1111-1111-1111-111111111111',
      );
    });

    it('should allow an employee who is the meeting host', async () => {
      meetingFindOne.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        hostId: 'user-1',
        deletedAt: null,
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '11111111-1111-1111-1111-111111111111' },
        socket,
      );
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalled();
    });

    it('should allow an employee who is a participant (not host)', async () => {
      meetingFindOne.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        hostId: 'other-host',
        deletedAt: null,
      });
      participantFindOne.mockResolvedValue({
        meetingId: '11111111-1111-1111-1111-111111111111',
        userId: 'user-1',
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '11111111-1111-1111-1111-111111111111' },
        socket,
      );
      expect(result.ok).toBe(true);
    });

    it('should reject an employee who is neither host nor participant of the meeting', async () => {
      meetingFindOne.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        hostId: 'other-host',
        deletedAt: null,
      });
      participantFindOne.mockResolvedValue(null);
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'random-user' };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '11111111-1111-1111-1111-111111111111' },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('should reject when the meeting does not exist', async () => {
      meetingFindOne.mockResolvedValue(null);
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: '11111111-1111-1111-1111-111111111111' },
        socket,
      );
      expect(result.ok).toBe(false);
    });

    it('should reject a malformed meetingId regardless of identity', async () => {
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleMeetingSubscribe(
        { meetingId: 'not-a-uuid' },
        socket,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('handleDisconnect — best-effort guest_leave', () => {
    it('should log guest_leave when the socket had a guest identity', () => {
      const socket = buildSocket();
      socket.data.identity = {
        type: 'guest',
        externalParticipantId: 'ep-1',
        meetingId: '11111111-1111-1111-1111-111111111111',
        jti: 'jti-1',
      };
      gateway.handleDisconnect(socket);
      expect(guestAttendanceService.logLeave).toHaveBeenCalledWith({
        externalParticipantId: 'ep-1',
        meetingId: '11111111-1111-1111-1111-111111111111',
        jti: 'jti-1',
      });
    });

    it('should NOT call logLeave for an employee identity', () => {
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      gateway.handleDisconnect(socket);
      expect(guestAttendanceService.logLeave).not.toHaveBeenCalled();
    });

    it('should NOT throw when there is no identity at all', () => {
      const socket = buildSocket();
      socket.data.identity = null;
      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
    });
  });

  describe('ivss:subscribe — kênh realtime họ tên + giờ vào/ra phòng họp', () => {
    it('từ chối socket ẩn danh (không token)', async () => {
      const socket = buildSocket();
      socket.data.identity = null;
      const result = await gateway.handleIvssSubscribe({ meetingId: '11111111-1111-1111-1111-111111111111' }, socket);
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('từ chối khách (guest token)', async () => {
      const socket = buildSocket();
      socket.data.identity = { type: 'guest', externalParticipantId: 'ep-1', meetingId: '11111111-1111-1111-1111-111111111111', jti: 'j' };
      const result = await gateway.handleIvssSubscribe({ meetingId: '11111111-1111-1111-1111-111111111111' }, socket);
      expect(result.ok).toBe(false);
    });

    it('từ chối nhân sự KHÔNG thuộc cuộc họp', async () => {
      meetingFindOne.mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111', hostId: 'other-host', deletedAt: null });
      participantFindOne.mockResolvedValue(null);
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleIvssSubscribe({ meetingId: '11111111-1111-1111-1111-111111111111' }, socket);
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('cho người tham dự vào kênh ivss:meeting:<id>', async () => {
      meetingFindOne.mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111', hostId: 'other-host', deletedAt: null });
      participantFindOne.mockResolvedValue({ meetingId: '11111111-1111-1111-1111-111111111111', userId: 'user-1' });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleIvssSubscribe({ meetingId: '11111111-1111-1111-1111-111111111111' }, socket);
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith('ivss:meeting:11111111-1111-1111-1111-111111111111');
    });
  });

  describe('user:subscribe — realtime /manager/meeting-approvals gate', () => {
    it('should reject when there is no identity at all', async () => {
      const socket = buildSocket();
      socket.data.identity = null;
      const result = await gateway.handleUserSubscribe(socket);
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('should reject a guest identity', async () => {
      const socket = buildSocket();
      socket.data.identity = {
        type: 'guest',
        externalParticipantId: 'ep-1',
        meetingId: '11111111-1111-1111-1111-111111111111',
        jti: 'jti-1',
      };
      const result = await gateway.handleUserSubscribe(socket);
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
      expect(authzRepo.getEffectiveRolesAndPermissions).not.toHaveBeenCalled();
    });

    it('subscribes an employee to their own notifications without approval permissions', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleUserSubscribe(socket);
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
    });

    it('should join user:{userId} for an employee with meeting_request.read permission', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['meeting_request.read', 'meeting_request.approve'],
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleUserSubscribe(socket);
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(authzRepo.getEffectiveRolesAndPermissions).not.toHaveBeenCalled();
    });

    it('should always subscribe to the caller own userId, ignoring any userId in the body', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['meeting_request.read'],
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      await gateway.handleUserSubscribe(socket);
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.join).not.toHaveBeenCalledWith(
        expect.stringContaining('other-user'),
      );
    });
  });

  describe('user:unsubscribe', () => {
    it('should leave user:{userId} for an authenticated employee', () => {
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = gateway.handleUserUnsubscribe(socket);
      expect(result.ok).toBe(true);
      expect(socket.leave).toHaveBeenCalledWith('user:user-1');
    });

    it('should no-op when there is no employee identity', () => {
      const socket = buildSocket();
      socket.data.identity = null;
      const result = gateway.handleUserUnsubscribe(socket);
      expect(result.ok).toBe(false);
      expect(socket.leave).not.toHaveBeenCalled();
    });
  });

  describe('zone:subscribe — B2 zone realtime gate (zones.gate_log.read)', () => {
    const ZONE_UUID = '44444444-4444-4444-4444-444444444444';

    it('should reject when there is no identity at all', async () => {
      const socket = buildSocket();
      socket.data.identity = null;
      const result = await gateway.handleZoneSubscribe(
        { zoneId: ZONE_UUID },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
      expect(authzRepo.getEffectiveRolesAndPermissions).not.toHaveBeenCalled();
    });

    it('should reject a guest identity (no zone use-case for guests)', async () => {
      const socket = buildSocket();
      socket.data.identity = {
        type: 'guest',
        externalParticipantId: 'ep-1',
        meetingId: '11111111-1111-1111-1111-111111111111',
        jti: 'jti-1',
      };
      const result = await gateway.handleZoneSubscribe(
        { zoneId: ZONE_UUID },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
      expect(authzRepo.getEffectiveRolesAndPermissions).not.toHaveBeenCalled();
    });

    it('should reject an employee without zones.gate_log.read permission', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleZoneSubscribe(
        { zoneId: ZONE_UUID },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('should join zone:{zoneId} for an employee with zones.gate_log.read permission', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['zones.gate_log.read'],
      });
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleZoneSubscribe(
        { zoneId: ZONE_UUID },
        socket,
      );
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith(`zone:${ZONE_UUID}`);
      expect(authzRepo.getEffectiveRolesAndPermissions).toHaveBeenCalledWith('user-1');
    });

    it('should reject a malformed zoneId regardless of identity', async () => {
      const socket = buildSocket();
      socket.data.identity = { type: 'employee', userId: 'user-1' };
      const result = await gateway.handleZoneSubscribe(
        { zoneId: 'not-a-uuid' },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(authzRepo.getEffectiveRolesAndPermissions).not.toHaveBeenCalled();
    });
  });

  describe('zone:unsubscribe', () => {
    it('should leave zone:{zoneId} for a valid zoneId', () => {
      const socket = buildSocket();
      const ZONE_UUID = '44444444-4444-4444-4444-444444444444';
      const result = gateway.handleZoneUnsubscribe({ zoneId: ZONE_UUID }, socket);
      expect(result.ok).toBe(true);
      expect(socket.leave).toHaveBeenCalledWith(`zone:${ZONE_UUID}`);
    });

    it('should reject a malformed zoneId', () => {
      const socket = buildSocket();
      const result = gateway.handleZoneUnsubscribe(
        { zoneId: 'not-a-uuid' },
        socket,
      );
      expect(result.ok).toBe(false);
      expect(socket.leave).not.toHaveBeenCalled();
    });
  });
});

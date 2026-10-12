// Chép từ SAVP-capstone-FE/src/mocks/visitorReport/visitStateMachine.test.js (VIS-BE-001 Task 3).
// Máy chủ chạy UTC: mọi so sánh theo ngày phải dùng múi Asia/Ho_Chi_Minh, nên ép TZ=UTC để chứng minh điều đó.
process.env.TZ = 'UTC';
import {
    TERMINAL_STATUSES, canTransition, nextStatus, availableActions, canExtend,
    isOverstay, shouldExpire, defaultAccessWindow, evaluateGateAttempt,
    isOnSite, overstayLevel, shouldMarkExitUnrecorded,
} from './visit-state-machine.js';

const visit = (over: Record<string, unknown> = {}): any => ({
    status: 'approved',
    visitor: { hasPhoto: true },
    access: {
        validFrom: '2026-10-08T01:30:00.000Z',
        validTo: '2026-10-08T04:30:00.000Z',
        zoneIds: ['zone-gate-main', 'zone-a1'],
    },
    ...over,
});
const inWindow = { at: '2026-10-08T02:00:00.000Z', zoneId: 'zone-gate-main', score: 0.93 };

describe('chuyển trạng thái', () => {
    test.each<[string, string, string]>([
        ['pending_approval', 'approve', 'approved'],
        ['pending_approval', 'reject', 'rejected'],
        ['pending_approval', 'cancel', 'cancelled'],
        ['approved', 'check_in', 'checked_in'],
        ['approved', 'revoke', 'revoked'],
        ['approved', 'cancel', 'cancelled'],
        ['approved', 'expire', 'expired'],
        ['checked_in', 'check_out', 'checked_out'],
        ['checked_in', 'revoke', 'must_leave'],
        ['checked_in', 'close_manual', 'checked_out'],
        ['checked_in', 'mark_unrecorded', 'exit_unrecorded'],
        ['must_leave', 'check_out', 'checked_out'],
        ['must_leave', 'close_manual', 'checked_out'],
        ['must_leave', 'mark_unrecorded', 'exit_unrecorded'],
        ['exit_unrecorded', 'close_manual', 'checked_out'],
    ])('%s + %s → %s', (from, action, to) => {
        expect(canTransition(from, action)).toBe(true);
        expect(nextStatus(from, action)).toBe(to);
    });

    test('trạng thái kết thúc không còn thao tác nào', () => {
        expect(TERMINAL_STATUSES.sort()).toEqual(['cancelled', 'checked_out', 'expired', 'rejected', 'revoked']);
        TERMINAL_STATUSES.forEach((s) => expect(availableActions(s)).toEqual([]));
    });

    test('chuyển không hợp lệ thì ném lỗi tiếng Việt', () => {
        expect(canTransition('pending_approval', 'check_in')).toBe(false);
        expect(() => nextStatus('checked_out', 'approve')).toThrow('Không thể');
    });
});

describe('gia hạn, quá giờ, hết hạn', () => {
    test('gia hạn chỉ khi approved/checked_in và thời điểm mới lớn hơn', () => {
        expect(canExtend(visit(), '2026-10-08T06:00:00.000Z')).toBe(true);
        expect(canExtend(visit({ status: 'checked_in' }), '2026-10-08T06:00:00.000Z')).toBe(true);
        expect(canExtend(visit(), '2026-10-08T04:30:00.000Z')).toBe(false);
        expect(canExtend(visit({ status: 'pending_approval' }), '2026-10-08T06:00:00.000Z')).toBe(false);
    });

    test('quá giờ là cờ của lượt đang checked_in', () => {
        const late = new Date('2026-10-08T05:00:00.000Z');
        expect(isOverstay(visit({ status: 'checked_in' }), late)).toBe(true);
        expect(isOverstay(visit({ status: 'approved' }), late)).toBe(false);
        expect(isOverstay(visit({ status: 'checked_in' }), new Date('2026-10-08T04:00:00.000Z'))).toBe(false);
    });

    test('hết hạn khi approved mà quá hiệu lực', () => {
        expect(shouldExpire(visit(), new Date('2026-10-08T05:00:00.000Z'))).toBe(true);
        expect(shouldExpire(visit({ status: 'checked_in' }), new Date('2026-10-08T05:00:00.000Z'))).toBe(false);
    });

    test('quyền mặc định rộng hơn giờ hẹn 30 phút mỗi đầu', () => {
        expect(defaultAccessWindow('2026-10-08T02:00:00.000Z', '2026-10-08T04:00:00.000Z')).toEqual({
            validFrom: '2026-10-08T01:30:00.000Z',
            validTo: '2026-10-08T04:30:00.000Z',
        });
    });
});

describe('nhận diện tại cổng', () => {
    test('trong khung giờ, đúng khu vực, đủ ngưỡng → tự check-in', () => {
        expect(evaluateGateAttempt(visit(), inWindow)).toEqual({ outcome: 'checked_in', reason: null });
    });
    test('đúng ngưỡng 0.80 vẫn qua', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, score: 0.8 }).outcome).toBe('checked_in');
    });
    test('dưới ngưỡng → lễ tân xác minh', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, score: 0.79 })).toEqual({ outcome: 'manual_review', reason: 'low_score' });
    });
    test('chưa có ảnh → lễ tân xác minh', () => {
        expect(evaluateGateAttempt(visit({ visitor: { hasPhoto: false } }), inWindow)).toEqual({ outcome: 'manual_review', reason: 'no_photo' });
    });
    test('ngoài khung giờ → chặn', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, at: '2026-10-08T06:00:00.000Z' })).toEqual({ outcome: 'access_denied', reason: 'outside_window' });
    });
    test('sai khu vực → chặn', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, zoneId: 'zone-b2' })).toEqual({ outcome: 'access_denied', reason: 'zone_not_allowed' });
    });
    test('lượt chưa duyệt → chặn', () => {
        expect(evaluateGateAttempt(visit({ status: 'pending_approval' }), inWindow)).toEqual({ outcome: 'access_denied', reason: 'invalid_status' });
    });
});

describe('bổ sung 2026-10-08: thu hồi khi đang ở trong, leo thang quá giờ, chưa ghi nhận giờ ra', () => {
    test('đang trong khuôn viên gồm cả khách phải rời', () => {
        expect(isOnSite(visit({ status: 'checked_in' }))).toBe(true);
        expect(isOnSite(visit({ status: 'must_leave' }))).toBe(true);
        expect(isOnSite(visit({ status: 'approved' }))).toBe(false);
        expect(isOnSite(visit({ status: 'exit_unrecorded' }))).toBe(false);
    });

    test('khách phải rời không thể thu hồi lần nữa hay check-in lại', () => {
        expect(canTransition('must_leave', 'revoke')).toBe(false);
        expect(canTransition('must_leave', 'check_in')).toBe(false);
        expect(canTransition('exit_unrecorded', 'check_out')).toBe(false);
    });

    test('mức leo thang quá giờ: 0 trong hạn, 1 khi vừa quá, 2 sau 30 phút', () => {
        const inside = visit({ status: 'checked_in' });
        expect(overstayLevel(inside, new Date('2026-10-08T04:30:00.000Z'))).toBe(0);
        expect(overstayLevel(inside, new Date('2026-10-08T04:31:00.000Z'))).toBe(1);
        expect(overstayLevel(inside, new Date('2026-10-08T04:59:59.000Z'))).toBe(1);
        expect(overstayLevel(inside, new Date('2026-10-08T05:00:00.000Z'))).toBe(2);
        expect(overstayLevel(visit({ status: 'approved' }), new Date('2026-10-08T06:00:00.000Z'))).toBe(0);
        expect(overstayLevel(visit({ status: 'must_leave' }), new Date('2026-10-08T06:00:00.000Z'))).toBe(0);
    });

    test('sang ngày mới sau ngày hết hiệu lực mà chưa có giờ ra → chưa ghi nhận giờ ra', () => {
        // d, h là ngày/giờ theo giờ Việt Nam (UTC+7).
        const at = (d: number, h: number) => new Date(Date.UTC(2026, 9, d, h - 7, 0));
        const inside = visit({ status: 'checked_in', access: { validFrom: at(8, 9).toISOString(), validTo: at(8, 17).toISOString(), zoneIds: [] } });
        expect(shouldMarkExitUnrecorded(inside, at(8, 23))).toBe(false);
        expect(shouldMarkExitUnrecorded(inside, at(9, 0))).toBe(true);
        expect(shouldMarkExitUnrecorded({ ...inside, status: 'checked_out' } as any, at(9, 8))).toBe(false);
        // Lượt nhiều ngày: còn hiệu lực thì chưa đánh dấu.
        const multiDay = visit({ status: 'checked_in', access: { validFrom: at(8, 9).toISOString(), validTo: at(10, 17).toISOString(), zoneIds: [] } });
        expect(shouldMarkExitUnrecorded(multiDay, at(9, 8))).toBe(false);
        // Khách phải rời: tính từ ngày bị thu hồi.
        const revoked: any = { ...multiDay, status: 'must_leave', revokedAt: at(8, 15).toISOString() };
        expect(shouldMarkExitUnrecorded(revoked, at(8, 23))).toBe(false);
        expect(shouldMarkExitUnrecorded(revoked, at(9, 1))).toBe(true);
    });

    test('nhận diện chiều vào: khách phải rời bị từ chối, khách đang ở trong không check-in lại', () => {
        expect(evaluateGateAttempt(visit({ status: 'must_leave' }), inWindow)).toEqual({ outcome: 'access_denied', reason: 'access_revoked' });
        expect(evaluateGateAttempt(visit({ status: 'checked_in' }), inWindow)).toEqual({ outcome: 'access_denied', reason: 'already_inside' });
    });
});

describe('ranh giới ngày theo giờ Việt Nam khi máy chủ chạy UTC', () => {
    const inside: any = visit({
        status: 'checked_in',
        access: { validFrom: '2026-10-08T01:00:00.000Z', validTo: '2026-10-08T10:00:00.000Z', zoneIds: [] },
    });
    test('23:59 giờ VN (16:59Z) chưa đánh dấu', () => {
        expect(shouldMarkExitUnrecorded(inside, new Date('2026-10-08T16:59:00.000Z'))).toBe(false);
    });
    test('00:00 hôm sau giờ VN (17:00Z) đánh dấu', () => {
        expect(shouldMarkExitUnrecorded(inside, new Date('2026-10-08T17:00:00.000Z'))).toBe(true);
    });
    test('quy tắc nhận thông số cấu hình: ngưỡng, đệm, số phút leo thang', () => {
        expect(defaultAccessWindow('2026-10-08T02:00:00.000Z', '2026-10-08T04:00:00.000Z', 10)).toEqual({
            validFrom: '2026-10-08T01:50:00.000Z', validTo: '2026-10-08T04:10:00.000Z',
        });
        expect(evaluateGateAttempt(visit(), { ...inWindow, score: 0.85 }, 0.9)).toEqual({ outcome: 'manual_review', reason: 'low_score' });
        const late: any = visit({ status: 'checked_in' });
        expect(overstayLevel(late, new Date('2026-10-08T04:40:00.000Z'), 10)).toBe(2);
    });
});

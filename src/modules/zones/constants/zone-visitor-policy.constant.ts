/**
 * Chính sách khách đến làm việc của một khu vực (admin/trưởng bảo vệ cấu hình ở Quản lý khu vực).
 * - `open`: mọi lượt khách tự được cấp (cổng chính, sảnh, căng tin). Cổng `open` = cổng mặc định cho khách.
 * - `grantable`: người được gặp được cấp khi duyệt.
 * - `restricted`: chỉ người có quyền `visitor.visit.manage` mới cấp được.
 */
export const ZONE_VISITOR_POLICIES = ['open', 'grantable', 'restricted'] as const;

export type ZoneVisitorPolicy = (typeof ZONE_VISITOR_POLICIES)[number];

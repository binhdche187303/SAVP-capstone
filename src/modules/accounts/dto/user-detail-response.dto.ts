import type { BiometricReviewStatus } from '../../../common/utils/biometric-status-resolver.util.js';

export class DepartmentInfoDto {
  id: string;
  departmentName: string;
}

export class DirectManagerInfoDto {
  id: string;
  fullName: string;
}

export class StudentClassInfoDto {
  id: string;
  code: string;
  name: string | null;
  lecturerName: string | null;
}

export class StudentProfileInfoDto {
  studentCode: string;
  administrativeClass: string | null;
  cohort: string | null;
  major: string | null;
  classSections: StudentClassInfoDto[];
}

export class RoleInfoDto {
  id: string;
  roleCode: string;
  roleName: string;
}

export class UserDetailResponseDto {
  id: string;
  employeeCode: string | null;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  positionTitle: string | null;
  isUnitClerk: boolean;
  leadershipTitle: string | null;
  department: DepartmentInfoDto | null;
  directManager: DirectManagerInfoDto | null;
  studentProfile: StudentProfileInfoDto | null;
  accountStatus: string;
  employmentStatus: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: RoleInfoDto[];
  hasFaceProfile: boolean;
  /** Trạng thái duyệt sinh trắc học chi tiết (BR-004) — xem biometric-status-resolver.util.ts */
  biometricReviewStatus: BiometricReviewStatus;
  /** Hạn sử dụng tài khoản — chỉ có giá trị với tài khoản đối tác/khách */
  accountExpiresAt: string | null;
  createdAt: string;
}

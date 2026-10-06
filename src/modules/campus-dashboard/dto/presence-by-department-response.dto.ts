export interface DepartmentPresenceDto {
  /** `null` = nhóm nhân sự chưa gán phòng ban (chỉ trả về khi nhóm này có người). */
  departmentId: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  /** Số người có log cổng CUỐI CÙNG hôm nay là `enter` (đã vào, chưa ra). */
  presentCount: number;
  /** Nhân sự đang làm việc (`employment_status='active'`, chưa xoá) của phòng ban. */
  totalStaff: number;
}

export interface PresenceByDepartmentResponseDto {
  generatedAt: string;
  totalPresent: number;
  departments: DepartmentPresenceDto[];
}

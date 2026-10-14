export class BiometricSubmissionListItemDto {
  faceProfileId: string;
  userId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  departmentName: string;
  /** users.avatar_url HIỆN TẠI — CHỈ để nhận diện "đây là ai", KHÔNG liên quan primaryImageFileId (D2). */
  avatarUrl: string | null;
  status: string;
  submittedAt: Date | null;
  primaryImageFileId: string | null;
  qualityScore: number | null;
  classSections?: Array<{
    id: string;
    code: string;
    name: string;
  }>;
}

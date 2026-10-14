export class ImageFileMetadataDto {
  fileName: string;
  mimeType: string;
  fileSizeBytes: string | null;
  storageProvider: string;
}

export class ReviewMetadataDto {
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export class BiometricSubmissionDetailDto {
  faceProfileId: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  /** users.avatar_url HIỆN TẠI — CHỈ để nhận diện "đây là ai", KHÔNG liên quan primaryImageFileId (D2). */
  avatarUrl: string | null;
  status: string;
  primaryImageFileId: string | null;
  imageFile: ImageFileMetadataDto | null;
  hasPreview: boolean;
  submittedAt: Date | null;
  consentAt: Date | null;
  reviewMetadata: ReviewMetadataDto | null;
  classSections?: Array<{
    id: string;
    code: string;
    name: string;
  }>;
}

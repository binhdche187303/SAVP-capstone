import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class RequestVisitorVerificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  contact!: string;
}

export class VerifyVisitorVerificationDto {
  @IsString()
  @IsNotEmpty()
  verificationId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

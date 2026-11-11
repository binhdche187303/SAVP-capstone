import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SsoExchangeDto {
  @ApiProperty({ description: 'Ticket dùng 1 lần nhận từ /sso/callback' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  ticket!: string;
}

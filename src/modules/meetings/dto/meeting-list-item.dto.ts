import { ApiProperty } from '@nestjs/swagger';

// BE-02 (2026-07-26): field tra ve cho GET /meetings (list, admin).
// KHONG include cancellationReason/description day du hay bat ky field
// lien quan noi dung nhay cam khac — day la man LIST tong quan, khong phai detail.
export class MeetingListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  meetingCode: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  meetingType: string;

  @ApiProperty()
  meetingMode: string;
  attendanceEnabled?: boolean;

  @ApiProperty()
  startTime: Date;

  @ApiProperty()
  endTime: Date;

  @ApiProperty({ nullable: true })
  roomId: string | null;

  @ApiProperty({ nullable: true })
  roomName: string | null;

  @ApiProperty()
  organizerId: string;

  @ApiProperty({ nullable: true })
  organizerName: string | null;

  @ApiProperty()
  createdAt: Date;

  // BE-5 (2026-07-31): co bao gio tao transcript cho meeting nay chua (bat ke
  // status draft/reviewed/approved/processing/failed) — FE dung de loc nhanh
  // danh sach meeting da co transcript, khong can mo tung meeting.
  @ApiProperty({
    description: 'Meeting da tung co transcript hay chua (bat ky status nao)',
  })
  hasTranscript: boolean;

  constructor(partial: MeetingListItemDto) {
    Object.assign(this, partial);
  }
}

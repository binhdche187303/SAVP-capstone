/** Kiểu item trả về của 13 API Đào tạo UEL. Mọi trường có thể null (theo tài liệu). */

type S = string | null;
type N = number | null;

export const UEL_API = {
  DS_NHANSU: 'nhansu/ds_nhansu',
  DS_PHONG_BAN: 'nhansu/ds_phong_ban',
  THONG_TIN_NHANSU: 'nhansu/thong_tin_nhansu',
  DS_LOPSV: 'sinhvien/ds_lopsv',
  DS_SV_LOPSV: 'sinhvien/ds_sv_lopsv',
  THONG_TIN_SV: 'sinhvien/thong_tin_sv',
  TKB_1BUOI: 'thoikhoabieu/chi_tiet_tkb_1buoi',
  TKB_GV_1NGAY: 'thoikhoabieu/chi_tiet_tkb_gv_1ngay',
  TKB_SV_1NGAY: 'thoikhoabieu/chi_tiet_tkb_sv_1ngay',
  TKB_DS_LOPHP: 'thoikhoabieu/tkb_ds_lophp',
  TKB_LOPHP_1NGAY: 'thoikhoabieu/tkb_lophp_1ngay',
  DKHP_CUA_1_LOPHP: 'dkhp/dkhp_ds_dangkycua1lophocphan',
  DKHP_CUA_1_SV: 'dkhp/dkhp_ds_dangkycua1sinhvien',
} as const;

export interface UelPhongBan {
  ma_phong_ban: S;
  ma_quan_ly: S;
  ten_phong_ban: S;
  ma_phong_ban_cha: S;
  ten_phong_ban_cha: S;
}

export interface UelNhanSu {
  ma_nhan_su: S;
  ma_quan_ly: S;
  ho: S;
  ten: S;
  ngay_sinh: S;
  gioi_tinh: S;
  cccd: S;
  email: S;
  ma_phong_ban: S;
  ten_phong_ban: S;
  loai: S;
  khong_con_cong_tac: boolean | null;
}

export interface UelLopSv {
  ma_lop: S;
  ten_lop: S;
  bac_dao_tao: S;
  loai_hinh_dao_tao: S;
  thuoc_khoa: S;
  si_so_sv: N;
}

export interface UelSvLopSv {
  ma_sinh_vien: S;
  ho_ten: S;
  ma_lop: S;
  ngay_sinh: S;
  email: S;
}

export interface UelLopHp {
  ma_lop_hoc_phan: S;
  ma_hoc_phan: S;
  ten_hoc_phan: S;
  nam_hoc: S;
  hoc_ky: S;
  so_tin_chi: N;
  ma_lop: S;
  giang_vien: S;
  si_so_sv: N;
}

export interface UelTkbLopHp1Ngay {
  ngay_hoc: S;
  ma_lop_hoc_phan: S;
  ten_hoc_phan: S;
  ma_hoc_phan: S;
  nam_hoc: S;
  hoc_ky: S;
  so_tin_chi: N;
  thu: N;
  tiet_bat_dau: N;
  so_tiet: N;
  ma_phong_hoc: S;
  ten_phong_hoc: S;
  ma_day_nha: S;
  ten_day_nha: S;
  ma_co_so: S;
  ten_co_so: S;
  ma_lich_hoc: N;
  buoi_hoc: S;
  ma_giang_vien: S;
  ten_giang_vien: S;
  /** "07:00" — có trong dữ liệu thật (chưa có trong tài liệu API). */
  gio_bat_dau?: S;
  /** "11:00" */
  gio_ket_thuc?: S;
}

/** chi_tiet_tkb_gv_1ngay / chi_tiet_tkb_sv_1ngay: cùng cấu trúc + mã người tra. */
export interface UelTkbNguoi1Ngay extends UelTkbLopHp1Ngay {
  ma_sinh_vien?: S;
}

export interface UelDangKy {
  ma_sinh_vien: S;
  ma_lop_hoc_phan: S;
  ngay_dang_ky: S;
  nam_hoc: S;
  hoc_ky: S;
  ma_hoc_phan: S;
  ten_hoc_phan: S;
  so_tin_chi: N;
  ma_hinh_thuc_dang_ky: S;
  hinh_thuc_dang_ky: S;
  ho_ten_sinh_vien: S;
}

/**
 * Dữ liệu giả cho scripts/uel-mock/server.mjs. Mọi tên, mã, email là bịa — không phải dữ liệu thật của UEL.
 *
 * Lịch học sinh theo tuần tính từ thứ Hai của tuần hiện tại (hoặc UEL_MOCK_START=yyyy-MM-dd),
 * kéo dài UEL_MOCK_WEEKS tuần (mặc định 3) — để lịch chạy tự động "hôm nay → +14 ngày" luôn có dữ liệu.
 * Định dạng ngày giả định yyyy-MM-dd (tài liệu chưa nêu, cần xác nhận với Trường).
 */

const NAM_HOC = '2026-2027';
const HOC_KY = '1';

const PHONG_BAN = [
  ['TRUONG', 'Trường Đại học (mock)', null, null],
  ['K_HTTT', 'Khoa Hệ thống thông tin', 'TRUONG', 'NS001'],
  ['BM_TMDT', 'Bộ môn Thương mại điện tử', 'K_HTTT', 'NS002'],
  ['K_KTDN', 'Khoa Kinh tế đối ngoại', 'TRUONG', 'NS004'],
  ['P_DT', 'Phòng Đào tạo', 'TRUONG', 'NS007'],
];

// [mã, họ, tên, email, phòng ban, quản lý, loại]
const NHAN_SU = [
  ['NS001', 'Trần Minh', 'An', 'an.tm@mock.uel.test', 'K_HTTT', null, 'Giảng viên'],
  ['NS002', 'Lê Thu', 'Bình', 'binh.lt@mock.uel.test', 'BM_TMDT', 'NS001', 'Giảng viên'],
  ['NS003', 'Phạm Quốc', 'Cường', 'cuong.pq@mock.uel.test', 'K_HTTT', 'NS001', 'Giảng viên'],
  ['NS004', 'Nguyễn Hải', 'Dương', 'duong.nh@mock.uel.test', 'K_KTDN', null, 'Giảng viên'],
  ['NS005', 'Võ Ngọc', 'Hà', 'ha.vn@mock.uel.test', 'K_KTDN', 'NS004', 'Giảng viên'],
  ['NS006', 'Đặng Gia', 'Khánh', null, 'K_KTDN', 'NS004', 'Giảng viên'],
  ['NS007', 'Hoàng Thị', 'Lan', 'lan.ht@mock.uel.test', 'P_DT', null, 'Chuyên viên'],
  ['NS008', 'Bùi Văn', 'Minh', 'minh.bv@mock.uel.test', 'P_DT', 'NS007', 'Chuyên viên'],
  ['NS009', 'Đỗ Thanh', 'Nga', 'nga.dt@mock.uel.test', 'P_DT', 'NS007', 'Chuyên viên'],
  ['NS010', 'Mai Hữu', 'Phúc', 'phuc.mh@mock.uel.test', 'K_HTTT', 'NS001', 'Giảng viên'],
];

const LOP_SV = [
  ['K25406', 'K25406 - Hệ thống thông tin quản lý', 'Khoa Hệ thống thông tin'],
  ['K25407', 'K25407 - Thương mại điện tử', 'Khoa Hệ thống thông tin'],
  ['K25401', 'K25401 - Kinh tế đối ngoại', 'Khoa Kinh tế đối ngoại'],
];

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Huỳnh', 'Võ'];
const DEM_TEN = ['Văn Anh', 'Thị Bảo', 'Minh Châu', 'Gia Đạt', 'Ngọc Giang', 'Quốc Huy'];

// [mã LHP, mã HP, tên HP, tín chỉ, lớp SV, GV, [thu, tiết bắt đầu, số tiết, phòng, dãy, cơ sở]]
const LOP_HP = [
  ['261MI0101_01', 'MI0101', 'Cơ sở dữ liệu', 3, 'K25406', 'NS003', [2, 1, 3, 'A.101', 'A', 'CS1']],
  ['261MI0101_02', 'MI0101', 'Cơ sở dữ liệu', 3, 'K25407', 'NS010', [4, 7, 3, 'A.102', 'A', 'CS1']],
  ['261MI0205_01', 'MI0205', 'Thương mại điện tử', 3, 'K25407', 'NS002', [3, 4, 2, 'B.201', 'B', 'CS1']],
  ['261IE0103_01', 'IE0103', 'Kinh tế quốc tế', 2, 'K25401', 'NS005', [5, 1, 4, 'C.305', 'C', 'CS2']],
];

const PHONG = {
  'A.101': 'Phòng A.101', 'A.102': 'Phòng A.102', 'A.103': 'Phòng A.103',
  'B.201': 'Phòng B.201', 'C.305': 'Phòng C.305',
};
const DAY_NHA = { A: 'Dãy A', B: 'Dãy B', C: 'Dãy C' };
const CO_SO = { CS1: 'Cơ sở chính (mock)', CS2: 'Cơ sở 2 (mock)' };

function mondayOf(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = x.getUTCDay() || 7; // CN = 7
  x.setUTCDate(x.getUTCDate() - (dow - 1));
  return x;
}
const iso = (d) => d.toISOString().slice(0, 10);

export function buildData(variant = 1) {
  const v2 = variant >= 2;

  const phongBan = PHONG_BAN.map(([ma, ten, cha, ql]) => ({
    ma_phong_ban: ma,
    ma_quan_ly: ql,
    ten_phong_ban: ten,
    ma_phong_ban_cha: cha,
    ten_phong_ban_cha: PHONG_BAN.find((p) => p[0] === cha)?.[1] ?? null,
  }));

  const nhanSu = NHAN_SU.filter(([ma]) => !(v2 && ma === 'NS008')) // v2: NS008 biến mất khỏi danh sách
    .map(([ma, ho, ten, email, pb, ql, loai], i) => ({
      ma_nhan_su: ma,
      ma_quan_ly: ql,
      ho,
      ten,
      ngay_sinh: `198${i}-0${(i % 9) + 1}-15`,
      gioi_tinh: i % 2 ? 'Nữ' : 'Nam',
      cccd: `0790000000${String(i).padStart(2, '0')}`,
      email,
      ma_phong_ban: pb,
      ten_phong_ban: PHONG_BAN.find((p) => p[0] === pb)[1],
      loai,
      khong_con_cong_tac: v2 && ma === 'NS009', // v2: NS009 nghỉ việc
    }));

  const svLopSv = [];
  const thongTinSv = [];
  for (const [maLop, , khoa] of LOP_SV) {
    for (let i = 0; i < 6; i++) {
      const code = `${maLop}${String(1001 + i)}`;
      const name = `${HO[i]} ${DEM_TEN[(i + maLop.length) % 6]}`;
      svLopSv.push({
        ma_sinh_vien: code,
        ho_ten: name,
        ma_lop: maLop,
        ngay_sinh: `2007-0${(i % 9) + 1}-0${(i % 9) + 1}`,
        email: i === 5 ? null : `${code.toLowerCase()}@st.mock.uel.test`,
      });
      thongTinSv.push({
        ma_sinh_vien: code,
        ho_ten: name,
        ngay_sinh: `2007-0${(i % 9) + 1}-0${(i % 9) + 1}`,
        noi_sinh: 'TP. Hồ Chí Minh',
        dan_toc: 'Kinh',
        ton_giao: 'Không',
        dia_chi: 'Địa chỉ giả',
        lop: maLop,
        khoa,
        khoa_hoc: 'K25',
      });
    }
  }
  const lopSv = LOP_SV.map(([ma, ten, khoa]) => ({
    ma_lop: ma,
    ten_lop: ten,
    bac_dao_tao: 'Đại học',
    loai_hinh_dao_tao: 'Chính quy',
    thuoc_khoa: khoa,
    si_so_sv: svLopSv.filter((s) => s.ma_lop === ma).length,
  }));

  const gvName = (ma) => {
    const n = NHAN_SU.find((x) => x[0] === ma);
    return `${n[1]} ${n[2]}`;
  };

  const dangKy = [];
  for (const [maLhp, maHp, tenHp, tc, maLop] of LOP_HP) {
    svLopSv
      .filter((s) => s.ma_lop === maLop)
      .filter((s) => !(v2 && maLhp === '261MI0101_01' && s.ma_sinh_vien === 'K254061002')) // v2: rút HP
      .forEach((s, i) => {
        dangKy.push({
          ma_sinh_vien: s.ma_sinh_vien,
          ma_lop_hoc_phan: maLhp,
          ngay_dang_ky: `2026-08-${String(10 + i).padStart(2, '0')}T08:00:00`,
          nam_hoc: NAM_HOC,
          hoc_ky: HOC_KY,
          ma_hoc_phan: maHp,
          ten_hoc_phan: tenHp,
          so_tin_chi: tc,
          ma_hinh_thuc_dang_ky: 'DK',
          hinh_thuc_dang_ky: 'Đăng ký mới',
          ho_ten_sinh_vien: s.ho_ten,
        });
      });
  }

  const lopHp = LOP_HP.map(([maLhp, maHp, tenHp, tc, maLop, gv]) => ({
    ma_lop_hoc_phan: maLhp,
    ma_hoc_phan: maHp,
    ten_hoc_phan: tenHp,
    nam_hoc: NAM_HOC,
    hoc_ky: HOC_KY,
    so_tin_chi: tc,
    ma_lop: maLop,
    giang_vien: gv,
    si_so_sv: dangKy.filter((d) => d.ma_lop_hoc_phan === maLhp).length,
  }));

  // Lịch học theo ngày.
  const start = process.env.UEL_MOCK_START
    ? new Date(`${process.env.UEL_MOCK_START}T00:00:00Z`)
    : mondayOf(new Date());
  const weeks = Number(process.env.UEL_MOCK_WEEKS ?? 3);
  const tkbNgay = [];
  for (let w = 0; w < weeks; w++) {
    for (let li = 0; li < LOP_HP.length; li++) {
      const [maLhp, maHp, tenHp, tc, , gv, [thu, tiet, soTiet, phong, day, coSo]] = LOP_HP[li];
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + (thu - 2) + 7 * w); // thu: 2 = thứ Hai
      const maLichHoc = 900000 + li * 100 + w;
      const ngay = iso(d);
      // v2: buổi tuần 2 của lớp đầu tiên bị hủy; buổi tuần 2 của lớp thứ hai đổi sang A.103.
      if (v2 && li === 0 && w === 1) continue;
      const phongThat = v2 && li === 1 && w === 1 ? 'A.103' : phong;
      tkbNgay.push({
        ngay_hoc: ngay,
        ma_lop_hoc_phan: maLhp,
        ten_hoc_phan: tenHp,
        ma_hoc_phan: maHp,
        nam_hoc: NAM_HOC,
        hoc_ky: HOC_KY,
        so_tin_chi: tc,
        thu,
        tiet_bat_dau: tiet,
        so_tiet: soTiet,
        ma_phong_hoc: phongThat,
        ten_phong_hoc: PHONG[phongThat],
        ma_day_nha: day,
        ten_day_nha: DAY_NHA[day],
        ma_co_so: coSo,
        ten_co_so: CO_SO[coSo],
        ma_lich_hoc: maLichHoc,
        buoi_hoc: tiet <= 6 ? 'Sáng' : 'Chiều',
        ma_giang_vien: gv,
        ten_giang_vien: gvName(gv),
      });
    }
  }
  tkbNgay.sort((a, b) => a.ngay_hoc.localeCompare(b.ngay_hoc) || a.tiet_bat_dau - b.tiet_bat_dau);

  const tkbSvNgay = [];
  const tkb1Buoi = [];
  for (const b of tkbNgay) {
    const svs = dangKy.filter((d) => d.ma_lop_hoc_phan === b.ma_lop_hoc_phan);
    for (const s of svs) {
      tkbSvNgay.push({ ...b, ma_sinh_vien: s.ma_sinh_vien });
      const lop = svLopSv.find((x) => x.ma_sinh_vien === s.ma_sinh_vien)?.ma_lop ?? null;
      tkb1Buoi.push({
        ma_buoi_hoc: b.ma_lich_hoc,
        ngay_hoc: b.ngay_hoc,
        thu: b.thu,
        tiet_bat_dau: b.tiet_bat_dau,
        so_tiet: b.so_tiet,
        ma_phong: b.ma_phong_hoc,
        ten_phong: b.ten_phong_hoc,
        ma_day_nha: b.ma_day_nha,
        ten_day_nha: b.ten_day_nha,
        ma_co_so: b.ma_co_so,
        ten_co_so: b.ten_co_so,
        ma_sinh_vien: s.ma_sinh_vien,
        ten_sinh_vien: s.ho_ten_sinh_vien,
        lop,
        ma_giang_vien: b.ma_giang_vien,
        ten_giang_vien: b.ten_giang_vien,
        ma_don_vi: null,
        ten_don_vi: null,
        buoi_hoc_thu: 1 + Math.floor((b.ma_lich_hoc % 100)),
      });
    }
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7 * weeks - 1);
  return {
    namHoc: NAM_HOC,
    hocKy: HOC_KY,
    fromDate: iso(start),
    toDate: iso(end),
    phongBan,
    nhanSu,
    lopSv,
    svLopSv,
    thongTinSv,
    lopHp,
    dangKy,
    tkbNgay,
    tkbSvNgay,
    tkb1Buoi,
  };
}

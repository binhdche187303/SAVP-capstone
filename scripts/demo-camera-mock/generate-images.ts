import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DEMO_PLATES } from './demo-plates';
import { allSeedPlates } from '../demo-seed/plates';

/**
 * Sinh ảnh demo bằng trình duyệt headless (Edge/Chrome có sẵn trên máy):
 * - images/plates/<BIỂN>.png — khung hình camera cổng, biển số ĐÚNG với cảnh báo (mock camera)
 *   và với mọi lượt xe của dữ liệu seed (scripts/demo-seed, phần ảnh).
 * - images/crowd/crowd-<n>.png — khung hình camera sảnh ghép từ ảnh mặt trong images/faces/.
 *
 *   npx tsx scripts/demo-camera-mock/generate-images.ts
 */

const IMAGES_DIR = path.join(__dirname, 'images');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const W = 1280;
const H = 720;

const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) {
  console.error('✖ Không tìm thấy Edge/Chrome để vẽ ảnh.');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-img-'));

function render(html: string, out: string) {
  const htmlFile = path.join(tmp, 'page.html');
  fs.writeFileSync(htmlFile, html);
  execFileSync(
    browser!,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${W},${H}`,
      `--screenshot=${out}`,
      '--virtual-time-budget=3000',
      `file:///${htmlFile.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  );
}

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

/** 51A99999 → 51A-999.99 ; 30C3139 → 30C-3139 */
function formatPlate(p: string): string {
  const m = /^(\d{2}[A-Z]{1,2})(\d+)$/.exec(p);
  if (!m) return p;
  const [, head, num] = m;
  return num.length === 5
    ? `${head}-${num.slice(0, 3)}.${num.slice(3)}`
    : `${head}-${num}`;
}

function timestamp(): string {
  const d = new Date(Date.now() - Math.floor(Math.random() * 3_600_000));
  return d.toLocaleString('vi-VN', { hour12: false });
}

const BASE_CSS = `
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: Arial, sans-serif; position: relative; }
  .osd { position: absolute; color: #fff; font: bold 22px Consolas, monospace; text-shadow: 2px 2px 2px #000; }
  .tl { top: 16px; left: 20px; } .tr { top: 16px; right: 20px; } .bl { bottom: 16px; left: 20px; }
  .rec { color: #ff3b3b; }
  .noise { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 2px, transparent 2px 4px); }
`;

function plateHtml(plate: string): string {
  const carColor = pick([
    '#d9d9d9',
    '#1f1f1f',
    '#8b1a1a',
    '#1d3f72',
    '#f2f2f2',
    '#5a5a5a',
  ]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  body { background: linear-gradient(#3b4048 0%, #2b2f35 45%, #55575a 46%, #3d3e40 100%); }
  .gate { position: absolute; top: 300px; left: 0; width: 100%; height: 16px; background: repeating-linear-gradient(90deg, #e33 0 60px, #fff 60px 120px); transform: rotate(-4deg); transform-origin: left; }
  .car { position: absolute; left: 340px; top: 210px; width: 600px; height: 430px; background: ${carColor}; border-radius: 120px 120px 40px 40px; box-shadow: 0 30px 60px rgba(0,0,0,.6); }
  .glass { position: absolute; left: 70px; top: 40px; width: 460px; height: 150px; background: linear-gradient(#20262e, #3a4552); border-radius: 80px 80px 10px 10px; }
  .lamp { position: absolute; top: 230px; width: 110px; height: 46px; background: #fff7c2; border-radius: 20px; box-shadow: 0 0 40px #fff3a0; }
  .grill { position: absolute; left: 190px; top: 235px; width: 220px; height: 40px; background: #111; border-radius: 8px; }
  .plate { position: absolute; left: 160px; top: 300px; width: 280px; height: 72px; background: #f8f8f8; border: 4px solid #111; border-radius: 6px; font: bold 46px Arial; letter-spacing: 2px; color: #111; display: flex; align-items: center; justify-content: center; }
  .box { position: absolute; left: 490px; top: 500px; width: 300px; height: 92px; border: 3px solid #39ff14; }
  .tag { position: absolute; left: 490px; top: 466px; background: #39ff14; color: #000; font: bold 20px Consolas; padding: 3px 8px; }
  </style></head><body>
  <div class="gate"></div>
  <div class="car"><div class="glass"></div><div class="lamp" style="left:40px"></div><div class="lamp" style="right:40px"></div><div class="grill"></div><div class="plate">${formatPlate(plate)}</div></div>
  <div class="tag">PLATE ${plate}</div><div class="box"></div>
  <div class="noise"></div>
  <div class="osd tl">CAM 904 · DEMO-GATE</div><div class="osd tr"><span class="rec">●</span> ${timestamp()}</div><div class="osd bl">ANPR · LPR</div>
  </body></html>`;
}

function crowdHtml(faces: string[], count: number): string {
  const people = Array.from({ length: count }, (_, i) => {
    const depth = Math.random();
    const size = Math.round(90 + depth * 130);
    const top = Math.round(200 + depth * 330);
    const left = Math.round(
      (i / count) * (W - size) + (Math.random() - 0.5) * 80,
    );
    const src = `file:///${pick(faces).replace(/\\/g, '/')}`;
    return `<div class="p" style="left:${left}px;top:${top}px;width:${size}px;z-index:${Math.round(depth * 100)}">
      <img src="${src}" style="width:${size}px;height:${size}px"><div class="body" style="height:${size * 1.4}px;background:${pick(['#2d4a7a', '#7a2d2d', '#2d6b4a', '#444', '#8a6d2d', '#5a3d7a'])}"></div></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  body { background: linear-gradient(#cfd5dc 0%, #b9c0c8 38%, #8d8f91 39%, #6e7072 100%); }
  .wall { position: absolute; top: 60px; left: 120px; width: 1040px; height: 180px; background: #e8ecef; border: 6px solid #9aa3ab; }
  .sign { position: absolute; top: 110px; left: 470px; font: bold 44px Arial; color: #2b4a73; }
  .p { position: absolute; }
  .p img { display: block; border-radius: 50%; object-fit: cover; }
  .p .body { margin-top: -10%; border-radius: 40% 40% 0 0; }
  .alert { position: absolute; bottom: 60px; right: 20px; background: rgba(220,30,30,.85); color: #fff; font: bold 26px Arial; padding: 8px 16px; z-index: 200; }
  </style></head><body>
  <div class="wall"></div><div class="sign">SẢNH CHÍNH</div>
  ${people}
  <div class="noise"></div>
  <div class="osd tl" style="z-index:200">CAM 903 · DEMO-LOBBY</div><div class="osd tr" style="z-index:200"><span class="rec">●</span> ${timestamp()}</div>
  <div class="alert">Đếm: ${count} người</div>
  </body></html>`;
}

function main() {
  const platesDir = path.join(IMAGES_DIR, 'plates');
  const crowdDir = path.join(IMAGES_DIR, 'crowd');
  fs.mkdirSync(platesDir, { recursive: true });
  fs.mkdirSync(crowdDir, { recursive: true });

  const plates = [...new Set([...DEMO_PLATES, ...allSeedPlates()])];
  console.log(`Vẽ ${plates.length} ảnh biển số…`);
  for (const plate of plates) {
    render(plateHtml(plate), path.join(platesDir, `${plate}.png`));
    console.log(`  ✔ plates/${plate}.png`);
  }

  const facesDir = path.join(IMAGES_DIR, 'faces');
  const faces = fs.existsSync(facesDir)
    ? fs
        .readdirSync(facesDir)
        .filter((f) => /\.(jpe?g|png)$/i.test(f))
        .map((f) => path.join(facesDir, f))
    : [];
  if (faces.length === 0) {
    console.warn('⚠ images/faces/ trống — bỏ qua ảnh đám đông.');
  } else {
    console.log('Vẽ ảnh đám đông…');
    for (let i = 1; i <= 6; i++) {
      const count = 9 + Math.floor(Math.random() * 8);
      render(crowdHtml(faces, count), path.join(crowdDir, `crowd-${i}.png`));
      console.log(`  ✔ crowd/crowd-${i}.png (${count} người)`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main();

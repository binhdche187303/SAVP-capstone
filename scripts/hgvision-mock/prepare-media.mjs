#!/usr/bin/env node
/**
 * Generates sample media for the HGVision mock (dev only): sample.mp4, hls/index.m3u8 + .ts, sample.jpg.
 * Needs ffmpeg on PATH. Output goes to scripts/hgvision-mock/.media (gitignored).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.media');
fs.mkdirSync(path.join(DIR, 'hls'), { recursive: true });

const run = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('Không tìm thấy ffmpeg trên PATH. Mock vẫn chạy được, chỉ thiếu video/HLS mẫu.');
  process.exit(1);
}

const src = ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-t', '60'];

console.log('→ sample.mp4');
run([...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-movflags', '+faststart', path.join(DIR, 'sample.mp4')]);

console.log('→ hls/index.m3u8');
run(['-i', path.join(DIR, 'sample.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
  '-hls_segment_filename', path.join(DIR, 'hls', 'seg%03d.ts'), path.join(DIR, 'hls', 'index.m3u8')]);

console.log('→ sample.jpg');
run(['-i', path.join(DIR, 'sample.mp4'), '-ss', '2', '-frames:v', '1', '-q:v', '4', path.join(DIR, 'sample.jpg')]);

console.log(`Xong: ${DIR}`);

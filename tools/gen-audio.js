'use strict';

// 用纯代码生成提示音/BGM 的 WAV 文件（无版权素材），供小程序 InnerAudioContext 播放。
// 延续 H5 版 WebAudio 程序合成的设计理念，只是把合成结果落盘为 PCM WAV。
// 运行：node tools/gen-audio.js
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'assets', 'audio');
const RATE = 22050;

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// 单个音符采样：freq 频率, dur 秒, vol 音量, type 波形, fade 是否做包络防爆音
function tone(freq, dur, vol, type, offset) {
  const n = Math.floor(RATE * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + (offset || 0)) / RATE;
    let v;
    if (type === 'triangle') v = 2 * Math.abs(2 * ((freq * t) % 1) - 1) - 1;
    else if (type === 'sawtooth') v = 2 * ((freq * t) % 1) - 1;
    else v = Math.sin(2 * Math.PI * freq * t);
    const env = Math.min(1, i / (RATE * 0.02)) * Math.min(1, (n - i) / (RATE * 0.03));
    out[i] = v * vol * Math.max(0, env);
  }
  return out;
}

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  parts.forEach(function (p) { out.set(p, o); o += p.length; });
  return out;
}

const silence = function (dur) { return new Float32Array(Math.floor(RATE * dur)); };

fs.mkdirSync(outDir, { recursive: true });

// 出牌：短促三角波
fs.writeFileSync(path.join(outDir, 'play.wav'), wav(tone(520, 0.12, 0.5, 'triangle')));
// 轮到你：两声上扬
fs.writeFileSync(path.join(outDir, 'turn.wav'), wav(concat([
  tone(660, 0.1, 0.45, 'sine'), silence(0.11), tone(880, 0.14, 0.4, 'sine')
])));
// 炸弹：低沉锯齿
fs.writeFileSync(path.join(outDir, 'bomb.wav'), wav(concat([
  tone(150, 0.28, 0.55, 'sawtooth'), tone(110, 0.3, 0.45, 'sawtooth')
])));

// BGM：8 拍循环旋律，约 3.4 秒
const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const seq = [0, 2, 4, 3, 2, 0, 1, 0];
const step = 0.42;
const bgmParts = [];
seq.forEach(function (idx, i) {
  bgmParts.push(tone(scale[idx], step * 0.9, 0.22, 'sine'));
  if (i % 4 === 0) bgmParts.push(tone(scale[idx] / 2, step * 0.9, 0.12, 'triangle'));
  else bgmParts.push(silence(step * 0.9));
});
fs.writeFileSync(path.join(outDir, 'bgm.wav'), wav(concat(bgmParts)));

// [RELEASE 2026-11-18] 转码：合成结果是未压缩 PCM WAV（4 个共 316KB），
// 直接打进小程序包太浪费首包预算。InnerAudioContext 支持 mp3，
// 故生成后立刻转 64kbps 单声道 mp3 并删除中间 wav（316KB → 58KB）。
const { execFileSync } = require('child_process');
const names = ['play', 'turn', 'bomb', 'bgm'];
try {
  names.forEach(function (name) {
    const wavPath = path.join(outDir, name + '.wav');
    const mp3Path = path.join(outDir, name + '.mp3');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', wavPath,
      '-codec:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', '-ac', '1', mp3Path
    ]);
    fs.unlinkSync(wavPath);
  });
} catch (e) {
  console.error('\n转码失败：需要本机安装 ffmpeg（macOS: brew install ffmpeg）。');
  console.error('当前只生成了 wav，utils/audio.js 引用的是 mp3，需先转码再使用。');
  process.exit(1);
}

names.forEach(function (name) {
  const s = fs.statSync(path.join(outDir, name + '.mp3'));
  console.log('生成 ' + name + '.mp3 (' + (s.size / 1024).toFixed(1) + ' KB)');
});
console.log('输出目录：' + outDir);

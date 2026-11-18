'use strict';

// 小程序音频：InnerAudioContext 播放本地音频（由 tools/gen-audio.js 合成并转码）。
// 替代 H5 版的 WebAudio 程序合成——小程序无 AudioContext，故把合成结果预先落盘。
// [RELEASE 2026-11-18] 产物用 mp3 而非 wav：同为合成音源，wav 是未压缩 PCM
// （4 个文件 316KB），转 64kbps mp3 后共约 58KB，对首包体积影响显著。
var SOURCES = {
  PLAY: '/assets/audio/play.mp3',
  TURN: '/assets/audio/turn.mp3',
  BOMB: '/assets/audio/bomb.mp3'
};
var BGM_SRC = '/assets/audio/bgm.mp3';

function createPlayer(src, loop) {
  try {
    var ctx = wx.createInnerAudioContext();
    ctx.src = src;
    ctx.loop = !!loop;
    // 小程序 audio 需用户手势后才可播放；创建时不自动播
    return ctx;
  } catch (e) {
    return null;
  }
}

var sfx = {};
var bgm = null;
var inited = false;
var bgmOn = false;
var settingsProvider = null;

// 注入设置读取器（由 app.js 在 onLaunch 调用），使音效/振动遵守用户开关。
function configure(provider) { settingsProvider = provider; }

function setting(key) {
  if (!settingsProvider) return false;
  try { return !!settingsProvider()[key]; } catch (e) { return false; }
}

function init() {
  if (inited) return;
  Object.keys(SOURCES).forEach(function (k) { sfx[k] = createPlayer(SOURCES[k], false); });
  bgm = createPlayer(BGM_SRC, true);
  inited = true;
}

function play(kind) {
  var p = sfx[kind];
  if (!p) return;
  try { p.stop(); p.play(); } catch (e) {}
}

function prompt(kind) {
  // 与 H5 playPrompt 语义对齐：PLAY / YOUR_TURN / BOMB。
  // 遵守"语音提示"开关（H5 版由 settings.dialect 控制）。
  if (!setting('dialect')) return;
  if (kind === 'BOMB') { play('BOMB'); return; }
  if (kind === 'YOUR_TURN') { play('TURN'); return; }
  play('PLAY');
}

function startBgm(enable) {
  init();
  if (!bgm) return;
  if (enable) {
    bgmOn = true;
    try { if (!bgm.paused) bgm.stop(); bgm.play(); } catch (e) {}
  } else {
    stopBgm();
  }
}

function stopBgm() {
  bgmOn = false;
  if (bgm) { try { bgm.stop(); } catch (e) {} }
}

// 切后台暂停、回前台恢复
function suspend() {
  try { if (bgm && !bgm.paused) bgm.pause(); } catch (e) {}
  Object.keys(sfx).forEach(function (k) { try { if (sfx[k]) sfx[k].stop(); } catch (e) {} });
}

function resume() {
  try { if (bgmOn && bgm && bgm.paused) bgm.play(); } catch (e) {}
}

// 触感反馈：遵守"振动反馈"开关；炸弹(heavy)即使音效关闭也保留反馈
function vibrate(type) {
  if (!setting('vibration')) return;
  try { wx.vibrateShort({ type: type === 'heavy' ? 'heavy' : 'light' }); } catch (e) {}
}

module.exports = {
  configure: configure, init: init, prompt: prompt, play: play,
  startBgm: startBgm, stopBgm: stopBgm,
  suspend: suspend, resume: resume, vibrate: vibrate
};

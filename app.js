'use strict';

// 微信小程序入口：核心逻辑直接复用仓库根 bundle.js（唯一真相源，无需同步副本）。
var SBM = require('./bundle.js');
var audio = require('./utils/audio.js');

// [RELEASE 2026-11-18] 线上排错兜底：小程序没有控制台日志留存，玩家报"白屏/点不动"时
// 开发者拿不到任何现场。这里把最近 20 条异常落本地，设置页可一键复制上报。
var ERR_KEY = 'sbm_errlog';
var ERR_MAX = 20;

function pushError(kind, detail) {
  try {
    var list = wx.getStorageSync(ERR_KEY);
    if (!Array.isArray(list)) list = [];
    var msg = '';
    var stack = '';
    if (detail && detail.message) { msg = detail.message; stack = detail.stack || ''; }
    else { msg = String(detail || ''); }
    list.unshift({
      t: Date.now(),
      kind: kind,
      msg: msg.slice(0, 300),
      stack: String(stack).slice(0, 800)
    });
    wx.setStorageSync(ERR_KEY, list.slice(0, ERR_MAX));
  } catch (e) {}
}

// [RELEASE 2026-11-18] 版本更新：不接 UpdateManager 时，发版后老用户会一直跑旧包，
// 修好的 bug 到不了他们手上，直到手动杀掉整个微信进程。
function setupUpdate() {
  try {
    if (!wx.getUpdateManager) return;
    var um = wx.getUpdateManager();
    um.onUpdateReady(function () {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已下载完成，重启后生效。',
        showCancel: false,
        confirmText: '立即重启',
        success: function () { try { um.applyUpdate(); } catch (e) {} }
      });
    });
    um.onUpdateFailed(function () {
      wx.showModal({
        title: '更新失败',
        content: '请退出小程序（右上角胶囊 → 关闭）后重新进入。',
        showCancel: false
      });
    });
  } catch (e) {}
}

// [FIX 2026-11-19] 续局快照带版本号并做结构校验。
// 旧实现只查 status / players.length，遇到旧版本结构或 activeSeat 越界时，
// controller.getView 里 players[seat].hand 会直接抛错 —— 白屏，且 onError 只记日志，
// 玩家没有任何出口。现在校验不过就丢弃快照、开新局，宁可不续也不能白屏。
var SESSION_VERSION = 2;

function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

function validSession(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.v !== SESSION_VERSION) return false;
  var g = s.game;
  if (!g || typeof g !== 'object') return false;
  if (g.status !== 'PLAYING') return false;
  if (!Array.isArray(g.players) || g.players.length < 2 || g.players.length > 4) return false;
  if (!isInt(g.currentSeat) || g.currentSeat < 0 || g.currentSeat >= g.players.length) return false;
  if (!Array.isArray(g.playedCards) || !Array.isArray(g.playLog)) return false;
  if (!g.config || !g.config.deck || !g.config.deck.removeRanks || !g.config.scoring) return false;
  var ok = g.players.every(function (p) {
    return p && typeof p === 'object' && typeof p.name === 'string' &&
      Array.isArray(p.hand) && p.hand.length > 0;
  });
  if (!ok) return false;
  if (s.activeSeat !== undefined && s.activeSeat !== null &&
      (!isInt(s.activeSeat) || s.activeSeat < 0 || s.activeSeat >= g.players.length)) return false;
  if (s.roundIndex !== undefined && (!isInt(s.roundIndex) || s.roundIndex < 1)) return false;
  if (s.roundTotals !== undefined && (typeof s.roundTotals !== 'object' || s.roundTotals === null)) return false;
  return true;
}

App({
  globalData: {
    SBM: SBM,
    settings: null,
    session: null,
    safeBottom: 0
  },

  onLaunch: function () {
    var self = this;
    this.globalData.settings = SBM.store.getSettings();
    // 让音频模块读取实时设置（音效/振动开关由用户控制）
    audio.configure(function () { return self.getSettings(); });
    // [FIX 2026-11-19] iOS 打开静音键后，InnerAudioContext 默认完全不出声，
    // 玩家会以为游戏没音效。牌类游戏的出牌声是核心反馈，必须跟随媒体音量而非静音键。
    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
      }
    } catch (e) {}
    try {
      var win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      var safe = win.screenHeight && win.safeArea ? (win.screenHeight - win.safeArea.bottom) : 0;
      this.globalData.safeBottom = safe > 0 ? safe : 0;
    } catch (e) {}
    setupUpdate();
  },

  onError: function (err) {
    pushError('error', err);
  },

  onUnhandledRejection: function (res) {
    pushError('promise', res && res.reason);
  },

  getErrorLog: function () {
    try {
      var list = wx.getStorageSync(ERR_KEY);
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  },

  clearErrorLog: function () {
    try { wx.removeStorageSync(ERR_KEY); } catch (e) {}
  },

  getSettings: function () {
    return this.globalData.settings || SBM.store.getSettings();
  },

  saveSettings: function (next) {
    this.globalData.settings = next;
    return SBM.store.saveSettings(next);
  },

  // 断点续局：对局快照存 storage
  saveSession: function (session) {
    if (!session || typeof session !== 'object') return null;
    session.v = SESSION_VERSION;
    this.globalData.session = session;
    try { wx.setStorageSync('sbm_session', session); } catch (e) {}
    return session;
  },

  getSession: function () {
    var s = this.globalData.session;
    if (!s) {
      try { s = wx.getStorageSync('sbm_session') || null; } catch (e) { s = null; }
    }
    if (!s) return null;
    // 校验失败立即清掉：留着只会在每次启动时重复踩同一个坑
    if (!validSession(s)) { this.clearSession(); return null; }
    this.globalData.session = s;
    return s;
  },

  clearSession: function () {
    this.globalData.session = null;
    try { wx.removeStorageSync('sbm_session'); } catch (e) {}
  },

  // [DESIGN 2026-11-18] 一轮多局：单局结算太碎片，没有"翻盘"叙事。
  // 以 5 局为一轮累计积分，轮次状态跨页面/跨进程持久化。
  getRound: function () {
    try { return wx.getStorageSync('sbm_round') || null; } catch (e) { return null; }
  },

  saveRound: function (state) {
    this.globalData.round = state;
    try { wx.setStorageSync('sbm_round', state); } catch (e) {}
    return state;
  },

  clearRound: function () {
    this.globalData.round = null;
    try { wx.removeStorageSync('sbm_round'); } catch (e) {}
  },

  // [RELEASE 2026-11-18] 主动退出未完成对局：记一次逃跑（只记次数、不计分），并清除快照避免重复统计。
  recordEscape: function () {
    this.clearSession();
    return SBM.store.updateStats(false, 0, true);
  }
});

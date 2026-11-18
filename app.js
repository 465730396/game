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
    this.globalData.session = session;
    try { wx.setStorageSync('sbm_session', session); } catch (e) {}
  },

  getSession: function () {
    if (this.globalData.session) return this.globalData.session;
    try { return wx.getStorageSync('sbm_session') || null; } catch (e) { return null; }
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

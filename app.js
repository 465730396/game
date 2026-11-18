'use strict';

// 微信小程序入口：核心逻辑直接复用仓库根 bundle.js（唯一真相源，无需同步副本）。
var SBM = require('./bundle.js');
var audio = require('./utils/audio.js');

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
  }
});

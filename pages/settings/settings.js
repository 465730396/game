'use strict';

var app = getApp();
var audio = require('../../utils/audio.js');

Page({
  data: { bgm: false, dialect: false, largeFont: true, vibration: false },

  onShow: function () {
    var s = app.getSettings();
    this.setData({
      bgm: !!s.bgm, dialect: !!s.dialect,
      largeFont: s.largeFont !== false, vibration: !!s.vibration
    });
  },

  onBgm: function (e) {
    var s = app.getSettings();
    s.bgm = e.detail.value;
    app.saveSettings(s);
    if (s.bgm) audio.startBgm(true); else audio.stopBgm();
  },

  onDialect: function (e) {
    var s = app.getSettings();
    s.dialect = e.detail.value;
    app.saveSettings(s);
    if (s.dialect) { audio.init(); audio.prompt('YOUR_TURN'); }
  },

  onFont: function (e) {
    var s = app.getSettings();
    s.largeFont = e.detail.value;
    app.saveSettings(s);
    // 本页根节点绑定 large-font，setData 后立即生效；其余页面在各自 onShow 时读取设置应用。
    this.setData({ largeFont: s.largeFont });
    wx.showToast({ title: s.largeFont ? '已开启大字模式' : '已关闭大字模式', icon: 'none' });
  },

  onVibration: function (e) {
    var s = app.getSettings();
    s.vibration = e.detail.value;
    app.saveSettings(s);
    if (s.vibration) audio.vibrate();
  },

  // 清掉已读标记，下次进牌桌重新展示引导（也方便给别人演示）
  onResetGuide: function () {
    try { wx.removeStorageSync('sbm_guided'); } catch (e) {}
    wx.showToast({ title: '下次进牌桌会再提示', icon: 'none' });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 设置', path: '/pages/index/index' };
  }
});

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
    this.applyRootClass();
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
    this.setData({ largeFont: s.largeFont });
    this.applyRootClass();
  },

  onVibration: function (e) {
    var s = app.getSettings();
    s.vibration = e.detail.value;
    app.saveSettings(s);
    if (s.vibration) audio.vibrate();
  },

  // 大字模式：切换根节点 class，卡牌/规则页样式随 app.wxss 的 .large-font 生效
  applyRootClass: function () {
    var pages = getCurrentPages();
    var page = pages[pages.length - 1];
    if (!page) return;
    // 当前页 root 组件由 page 承载，用 setData 传递标记供各页 wxss 使用
    this.setData({ largeFont: this.data.largeFont });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 设置', path: '/pages/index/index' };
  }
});

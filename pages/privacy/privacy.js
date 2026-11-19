'use strict';

// [RELEASE 2026-11-19] 用户隐私保护指引页。
//
// 为什么必须有这一页：
// 1) 小程序调用了 saveImageToPhotosAlbum（隐私接口），后台《用户隐私保护指引》里
//    声明了"相册（仅写入）"，页内还必须给玩家一个可点开的正文入口，否则是审核高频驳回点；
// 2) 审核员会核对"声明了什么、代码实际用了什么、正文写了什么"三者是否一致，
//    所以本页每一条都能在代码里找到对应实现，不写没有的、不隐瞒有的。
// 3) 顺带给玩家一个"删除本机数据"的出口——这是 PIPL 里"删除权"最朴素的落地。

var app = getApp();

Page({
  data: {
    largeFont: false,
    updated: '2026-11-19',
    sections: [
      {
        title: '一、这个游戏收集什么',
        paras: [
          '本小程序是单机离线牌类游戏，没有账号体系，不需要登录，不会上传任何对局数据。',
          '以下内容仅保存在你自己的手机本地（微信小程序本地存储），不会离开设备：设置项（音效、大字模式、规则档）、对局记录（胜负、积分、时间）、累计统计（局数、胜场、逃跑次数）、断点续局快照、每日挑战成绩、最近 20 条异常日志。'
        ]
      },
      {
        title: '二、会用到哪些系统权限',
        paras: [
          '相册（仅写入）：只有你主动点击"保存战绩图"时才会调用，用于把结算图存进相册。本小程序不会读取你的相册内容。',
          '剪贴板（仅写入）：只有你主动点击"复制异常记录"时才会写入，内容仅是错误日志文本，方便你反馈问题。',
          '振动：出牌与炸弹时的触感反馈，可在设置页关闭。'
        ]
      },
      {
        title: '三、不会获取的信息',
        paras: [
          '不获取微信昵称、头像、手机号、地理位置、通讯录、摄像头与麦克风。',
          '不接入任何第三方统计、广告或推送 SDK；不做用户画像，不做个性化推荐。'
        ]
      },
      {
        title: '四、数据保存与删除',
        paras: [
          '所有数据只存在本机。卸载小程序、或在微信中清除该小程序缓存，数据即被删除。',
          '你也可以在本页底部点"清除本机数据"，一键删除对局记录、统计、续局快照、每日挑战成绩与异常日志（设置项会保留）。'
        ]
      },
      {
        title: '五、未成年人',
        paras: [
          '本游戏为娱乐性牌类玩法，积分仅作本地记录，不涉及任何真实货币、虚拟币或物品兑换，不提供付费项目。',
          '若你是未成年人，请在监护人指导下使用，并注意控制游戏时间。'
        ]
      },
      {
        title: '六、政策更新与联系方式',
        paras: [
          '本指引如有变更，会在本页更新并标注日期，不再单独通知。',
          '如对本指引有疑问，可通过小程序内的"运行诊断 → 复制异常记录"把问题发给我们，或在提交审核时预留的客服邮箱联系我们。'
        ]
      }
    ]
  },

  onShow: function () {
    this.setData({ largeFont: app.getSettings().largeFont !== false });
  },

  // 删除权的最小实现：只清对局数据，保留用户自己的偏好设置
  onClear: function () {
    var self = this;
    wx.showModal({
      title: '清除本机数据',
      content: '将删除对局记录、统计、续局快照、每日挑战成绩与异常日志，且无法恢复。设置项会保留。',
      confirmText: '清除',
      confirmColor: '#C0453C',
      success: function (r) {
        if (!r.confirm) return;
        try {
          var SBM = app.globalData.SBM;
          if (SBM && SBM.store && SBM.store.clearRecords) SBM.store.clearRecords();
          ['sbm_session', 'sbm_round', 'sbm_daily', 'sbm_errlog', 'sbm_guided'].forEach(function (k) {
            try { wx.removeStorageSync(k); } catch (e) {}
          });
          app.clearSession && app.clearSession();
          app.clearRound && app.clearRound();
          app.globalData.lastResult = null;
          wx.showToast({ title: '已清除', icon: 'success' });
          self.setData({ cleared: true });
        } catch (e) {
          wx.showToast({ title: '清除失败，请重试', icon: 'none' });
        }
      }
    });
  },

  onShareAppMessage: function () {
    return { title: '陕北捉老麻 · 隐私说明', path: '/pages/index/index' };
  }
});

'use strict';

var app = getApp();

Page({
  data: {
    noData: false, won: false, badgeText: '', badgeClass: '',
    title: '', ruleSetId: '', time: '', scores: [], hotseat: false,
    largeFont: false,
    roundIndex: 0, roundSize: 0, roundDone: false, roundLabel: '', againLabel: '再来一局',
    totals: [], multiplier: 1, multiText: ''
  },

  onLoad: function () {
    this.setData({ largeFont: app.getSettings().largeFont !== false });
    var r = app.globalData.lastResult;
    if (!r) {
      // [RELEASE 2026-11-18] 兜底：小程序被回收或热重载后结算数据可能丢失，
      // 旧实现只弹 toast，页面上仍是空的胜负与积分，玩家看着像坏了。
      this.setData({ noData: true, title: '本局数据已失效' });
      return;
    }
    // 角标语义修正：热座没有"我"的概念。旧逻辑用 winnerSeat===0 判断胜负，
    // 其他玩家赢时会显示"玩家X 赢下这一局"却配一个"负"角标，自相矛盾。
    var badgeText = r.hotseat ? '赢家' : (r.won ? '胜' : '负');
    var badgeClass = r.hotseat ? 'draw' : (r.won ? 'win' : 'lose');
    var title;
    if (r.hotseat) title = r.winnerName + ' 赢下这一局';
    else title = r.won ? '你赢下这一局' : (r.winnerName + ' 赢下这一局');

    var rd = r.round || null;
    var roundLabel = rd ? ('第 ' + rd.index + ' / ' + rd.size + ' 局') : '';
    var againLabel = rd && !rd.done ? ('下一局（第 ' + (rd.index + 1) + ' 局）') : '开始新一轮';

    this.setData({
      noData: false,
      won: !!r.won,
      badgeText: badgeText,
      badgeClass: badgeClass,
      title: title,
      ruleSetId: r.ruleSetId || '',
      time: r.time || '',
      scores: r.scores || [],
      hotseat: !!r.hotseat,
      roundIndex: rd ? rd.index : 0,
      roundSize: rd ? rd.size : 0,
      roundDone: rd ? !!rd.done : false,
      roundLabel: roundLabel,
      againLabel: againLabel,
      totals: rd && rd.totals ? rd.totals.slice().sort(function (a, b) { return b.total - a.total; }) : [],
      multiplier: r.multiplier || 1,
      multiText: (r.multiplier && r.multiplier > 1) ? ('本局炸弹翻倍 ×' + r.multiplier) : ''
    });

    // 预热战绩图，分享时能直接带上图片（失败也不影响页面）
    var self = this;
    setTimeout(function () { self.ensurePoster(); }, 500);
  },

  // 再来一局沿用本局的模式 / 人数 / 难度；旧实现固定 NORMAL，玩家选困难打完却变回普通。
  // 一轮未打满时带上 round=1 继续累计，打满则开新一轮。
  onAgain: function () {
    var r = app.globalData.lastResult || {};
    var mode = r.mode || (r.hotseat ? 'HOTSEAT' : 'AI');
    var level = r.level || 'NORMAL';
    var count = r.count || (r.scores ? r.scores.length : 3);
    var rd = r.round || null;
    var next = rd && !rd.done ? '&round=1' : '';
    if (rd && rd.done) app.clearRound();
    wx.redirectTo({ url: '/pages/game/game?mode=' + mode + '&count=' + count + '&level=' + level + next });
  },

  // reLaunch 而不是 navigateBack(2)：牌桌是 redirectTo 替换进来的，栈深不可靠。
  onHome: function () { wx.reLaunch({ url: '/pages/index/index' }); },

  // [DESIGN 2026-11-18] 战绩图：棋牌类小程序的增长几乎全靠"拉人开局"，
  // 旧版分享只有标题没有图，点开率极低。这里用 canvas 2d 现画一张可直接保存的战绩卡。
  ensurePoster: function (cb) {
    var self = this;
    if (this.posterPath) { if (cb) cb(this.posterPath); return; }
    if (this.buildingPoster) return;
    var r = app.globalData.lastResult;
    if (!r) { if (cb) cb(null); return; }
    this.buildingPoster = true;
    wx.createSelectorQuery().select('#poster').fields({ node: true, size: true }).exec(function (res) {
      self.buildingPoster = false;
      var node = res && res[0] && res[0].node;
      if (!node) { if (cb) cb(null); return; }
      var W = 750, H = 1000;
      node.width = W; node.height = H;
      var ctx = node.getContext('2d');
      self.paintPoster(ctx, W, H, r);
      wx.canvasToTempFilePath({
        canvas: node, x: 0, y: 0, width: W, height: H, destWidth: W, destHeight: H,
        success: function (out) { self.posterPath = out.tempFilePath; if (cb) cb(out.tempFilePath); },
        fail: function () { if (cb) cb(null); }
      });
    });
  },

  paintPoster: function (ctx, W, H, r) {
    var GOLD = '#E8C57A', DIM = '#9A8360', INK = '#F3E6CE', RED = '#C0392B', GREEN = '#6FB98A';
    ctx.fillStyle = '#1B1018'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#241419'; ctx.fillRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = 'rgba(232,197,122,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);

    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD; ctx.font = 'bold 40px sans-serif';
    ctx.fillText('陕北捉老麻', W / 2, 130);
    ctx.fillStyle = DIM; ctx.font = '22px sans-serif';
    ctx.fillText('夜宴牌局 · 娱乐积分', W / 2, 172);

    ctx.fillStyle = r.hotseat ? DIM : (r.won ? GOLD : RED);
    ctx.font = 'bold 96px sans-serif';
    ctx.fillText(r.hotseat ? '赢家' : (r.won ? '胜' : '负'), W / 2, 320);

    ctx.fillStyle = INK; ctx.font = '30px sans-serif';
    var line = r.hotseat ? (r.winnerName + ' 赢下这一局')
      : (r.won ? '你赢下这一局' : (r.winnerName + ' 赢下这一局'));
    ctx.fillText(line, W / 2, 385);

    var rd = r.round || {};
    ctx.fillStyle = DIM; ctx.font = '24px sans-serif';
    var sub = (rd.index ? ('第 ' + rd.index + ' / ' + rd.size + ' 局') : '') + (r.time ? (' · ' + r.time) : '');
    ctx.fillText(sub, W / 2, 428);

    if (r.multiplier && r.multiplier > 1) {
      ctx.fillStyle = RED; ctx.font = '24px sans-serif';
      ctx.fillText('炸弹翻倍 ×' + r.multiplier, W / 2, 468);
    }

    ctx.strokeStyle = 'rgba(232,197,122,0.25)';
    ctx.beginPath(); ctx.moveTo(120, 505); ctx.lineTo(W - 120, 505); ctx.stroke();

    var rows = (r.scores || []).slice(0, 4);
    rows.forEach(function (row, i) {
      var y = 570 + i * 74;
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 0 ? GOLD : DIM;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(String(row.rank), 150, y);
      ctx.fillStyle = INK; ctx.font = '30px sans-serif';
      ctx.fillText(row.name, 200, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = row.delta > 0 ? '#E05A4E' : GREEN;
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText((row.delta > 0 ? '+' : '') + row.delta, W - 150, y);
      ctx.textAlign = 'center';
    });

    ctx.fillStyle = DIM; ctx.font = '22px sans-serif';
    ctx.fillText('微信搜索「陕北捉老麻」一起来一局', W / 2, H - 90);
    ctx.fillStyle = 'rgba(154,131,96,0.75)'; ctx.font = '18px sans-serif';
    ctx.fillText('娱乐积分，不兑换任何物品', W / 2, H - 58);
  },

  onSavePoster: function () {
    var self = this;
    wx.showLoading({ title: '生成中', mask: true });
    this.ensurePoster(function (path) {
      wx.hideLoading();
      if (!path) { wx.showToast({ title: '生成失败，可先试试截图', icon: 'none' }); return; }
      self.saveOrPreview(path);
    });
  },

  saveOrPreview: function (path) {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: function () { wx.showToast({ title: '已保存到相册' }); },
      fail: function (err) {
        var msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存战绩图需要相册权限，可在设置里开启。',
            confirmText: '去设置',
            success: function (m) { if (m.confirm) wx.openSetting(); }
          });
        } else {
          wx.previewImage({ urls: [path], current: path });
        }
      }
    });
  },

  onShareAppMessage: function () {
    var r = app.globalData.lastResult || {};
    var title = r.won ? '我赢下了这一局，陕北捉老麻来一局？'
      : (r.round && r.round.index ? ('第 ' + r.round.index + ' 局打完了，来一局陕北捉老麻？') : '陕北捉老麻 · 来一局？');
    var out = { title: title, path: '/pages/index/index' };
    if (this.posterPath) out.imageUrl = this.posterPath;
    return out;
  }
});

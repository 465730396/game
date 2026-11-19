'use strict';

// 页面级回归（需在 Node 下跑）：用最小 wx mock 真跑 app.js 与 pages/game/game.js。
// 覆盖的都是"单测跑不到、只在运行时或真机才暴露"的缺陷：
//   1. 续局快照结构校验（坏快照必须丢弃，好快照必须能续）
//   2. 每日挑战结算不得清空进行中的轮次
//   3. 结算延迟跳转必须能被卸载/重开取消
//   4. 热座交接期间不得把真实手牌下发给视图层
//   5. 每日挑战成绩以首次为准
// 运行：node tools/test-pages.js

var path = require('path');
var ROOT = path.resolve(__dirname, '..');

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  (' + extra + ')' : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---- 最小 wx 环境 ----
var store = {};
var redirects = [];
var modalConfirm = true;
var innerAudioOpt = null;

global.wx = {
  getStorageSync: function (k) { return store[k] === undefined ? '' : store[k]; },
  setStorageSync: function (k, v) { store[k] = v; },
  removeStorageSync: function (k) { delete store[k]; },
  getWindowInfo: function () { return { screenWidth: 375, screenHeight: 800, pixelRatio: 2, safeArea: { bottom: 760 } }; },
  getSystemInfoSync: function () { return { screenWidth: 375, screenHeight: 800, pixelRatio: 2, safeArea: { bottom: 760 } }; },
  setInnerAudioOption: function (o) { innerAudioOpt = o; },
  getUpdateManager: function () { return null; },
  createInnerAudioContext: function () {
    return { play: function () {}, stop: function () {}, pause: function () {}, paused: true };
  },
  createSelectorQuery: function () {
    var q = {};
    q.in = function () { return q; }; q.select = function () { return q; };
    q.fields = function () { return q; }; q.exec = function () {};
    return q;
  },
  showModal: function (o) { if (o && o.success) o.success({ confirm: modalConfirm, cancel: !modalConfirm }); },
  showToast: function () {},
  vibrateShort: function () {},
  redirectTo: function (o) { redirects.push(o.url); },
  reLaunch: function () {},
  setClipboardData: function () {}
};

var appObj = null;
global.App = function (o) { appObj = o; };
require(path.join(ROOT, 'app.js'));
appObj.onLaunch();

var SBM = require(path.join(ROOT, 'bundle.js'));
var controller = SBM.controller;

global.getApp = function () { return appObj; };
var pageCfg = null;
global.Page = function (o) { pageCfg = o; };
require(path.join(ROOT, 'pages/game/game.js'));

function newCtx(opts) {
  var ctx = {};
  Object.keys(pageCfg).forEach(function (k) { ctx[k] = pageCfg[k]; });
  ctx.data = { handoff: false };
  ctx.lastData = null;
  ctx.setData = function (o) { ctx.lastData = o; };
  ctx.selected = []; ctx.lines = {}; ctx.totals = {}; ctx.roundHistory = [];
  ctx.alive = true; ctx.redirected = false; ctx.redirectTimer = null;
  ctx.finished = false; ctx.aiTimer = null;
  ctx.fx = { celebrate: function () {}, stop: function () {} };
  Object.keys(opts || {}).forEach(function (k) { ctx[k] = opts[k]; });
  return ctx;
}

function finishedGame(seed) {
  var g = controller.createGame({ playerCount: 3, seed: seed, difficulties: ['HARD', 'HARD', 'HARD'] });
  g.players.forEach(function (p) { p.isAI = true; });
  var guard = 0;
  while (g.status === 'PLAYING' && guard++ < 500) controller.aiTakeTurn(g);
  return g;
}

// ---- 1. 音频与快照校验 ----
section('1. 启动配置与续局快照校验');
ok(!!innerAudioOpt && innerAudioOpt.obeyMuteSwitch === false,
  'iOS 静音键下仍可出声', 'obeyMuteSwitch=' + (innerAudioOpt && innerAudioOpt.obeyMuteSwitch));

function sess(over) {
  var s = {
    game: controller.createGame({ playerCount: 3, seed: 42, difficulties: ['NORMAL', 'NORMAL', 'NORMAL'] }),
    mode: 'AI', level: 'NORMAL', count: 3, hotseat: false,
    activeSeat: 0, roundIndex: 2, roundTotals: {}, roundHistory: []
  };
  Object.keys(over || {}).forEach(function (k) { s[k] = over[k]; });
  return s;
}
appObj.saveSession(sess({}));
ok(!!appObj.getSession(), '正常快照可续');
appObj.clearSession();
store['sbm_session'] = sess({});
ok(appObj.getSession() === null, '老版本快照（无版本号）被拒');
ok(store['sbm_session'] === undefined, '被拒后 storage 立即清除');
appObj.saveSession(sess({ activeSeat: 9 }));
ok(appObj.getSession() === null, 'activeSeat 越界被拒');
appObj.saveSession(sess({}));
store['sbm_session'].game.players[1].hand = undefined;
ok(appObj.getSession() === null, '手牌结构缺失被拒');
appObj.saveSession(sess({}));
store['sbm_session'].game.currentSeat = 7;
ok(appObj.getSession() === null, 'currentSeat 越界被拒');
appObj.saveSession(sess({}));
delete store['sbm_session'].game.config.scoring;
ok(appObj.getSession() === null, '缺计分配置被拒');

// ---- 2. 每日挑战与轮次 ----
section('2. 每日挑战不破坏轮次进度');
var roundCleared = 0, roundSaved = null;
var realClear = appObj.clearRound, realSave = appObj.saveRound;
appObj.clearRound = function () { roundCleared++; };
appObj.saveRound = function (s) { roundSaved = s; return s; };

var a = newCtx({ daily: true, roundIndex: 1, roundSize: 1, hotseat: false, game: finishedGame(11), dailyDate: '2026-11-19' });
a.finishGame();
ok(roundCleared === 0, '每日挑战结算不清轮次', 'clearRound 调用 ' + roundCleared + ' 次');
ok(roundSaved === null, '每日挑战不写轮次状态');

roundCleared = 0; roundSaved = null;
var b = newCtx({ daily: false, roundIndex: 5, roundSize: 5, hotseat: false, game: finishedGame(12) });
b.finishGame();
ok(roundCleared === 1, '第 5/5 局正常清轮次');

roundCleared = 0; roundSaved = null;
var c = newCtx({ daily: false, roundIndex: 2, roundSize: 5, hotseat: false, game: finishedGame(13) });
c.finishGame();
ok(roundSaved && roundSaved.index === 3, '第 2/5 局写入下一局', 'index=' + (roundSaved && roundSaved.index));
ok(roundSaved && typeof roundSaved.nextFirstSeat === 'number', '携带末位先出座位');
appObj.clearRound = realClear; appObj.saveRound = realSave;

// ---- 3. 结算跳转竞态 ----
section('3. 结算延迟跳转可取消');
[a, b, c].forEach(function (x) { x.alive = false; x.clearRedirect(); });
redirects = [];
var d = newCtx({ daily: true, roundIndex: 1, roundSize: 1, hotseat: false, game: finishedGame(14), dailyDate: '2026-11-19' });
d.finishGame();
d.alive = false;
d.onUnload();
ok(d.redirectTimer === null, '卸载后定时器已清除');

redirects = [];
var e = newCtx({ daily: true, roundIndex: 1, roundSize: 1, hotseat: false, game: finishedGame(15), dailyDate: '2026-11-19' });
e.finishGame();
modalConfirm = true;
e.onRestart();
ok(e.redirectTimer === null, '重开后定时器已取消');
ok(e.game.status === 'PLAYING', '重开产生新对局');

// ---- 4. 热座遮挡 ----
section('4. 热座交接期间不下发手牌');
var h = newCtx({ hotseat: true, activeSeat: 1, level: 'NORMAL', ruleMode: 'CLASSIC' });
h.game = controller.createGame({ playerCount: 3, seed: 3, difficulties: ['NORMAL', 'NORMAL', 'NORMAL'] });
h.game.players.forEach(function (p) { p.isAI = false; });
var realCount = h.game.players[1].hand.length;
h.data = { handoff: true };
h.render();
ok(h.lastData.hand.length === 0, '交接中 hand 为空', '真实手牌 ' + realCount + ' 张');
ok(h.lastData.handTitle.indexOf('遮挡') >= 0, '标题提示已遮挡');
var played = 0, origPlay = controller.play;
controller.play = function () { played++; return { ok: false }; };
h.selected = [h.game.players[1].hand[0].id];
h.onPlay();
ok(played === 0, '交接中出牌被拦截');
controller.play = origPlay;
h.data = { handoff: false };
h.render();
ok(h.lastData.hand.length === realCount, '接手后手牌恢复', '共 ' + h.lastData.hand.length + ' 张');
h.game = null;

// ---- 5. 每日挑战成绩锁定 ----
section('5. 每日挑战成绩以首次为准');
// 第 2 节的每日挑战结算已经写过当天成绩，这里必须清掉，否则测的是"已锁定"而不是"首次写入"
delete store['sbm_daily'];
var f = newCtx({ daily: true, dailyDate: '2026-11-19' });
f.saveDaily(120, true);
f.saveDaily(999, true);
ok(store['sbm_daily'] && store['sbm_daily'].delta === 120, '同日重打不覆盖首次成绩', '保留 ' + (store['sbm_daily'] && store['sbm_daily'].delta));
var f2 = newCtx({ daily: true, dailyDate: '2026-11-20' });
f2.saveDaily(80, false);
ok(store['sbm_daily'].delta === 80, '次日写入新成绩');

// 等待可能的残留定时器执行，确认没有漏网跳转
setTimeout(function () {
  section('6. 无残留跳转');
  ok(redirects.length === 0, '本轮用例未触发任何结算跳转', 'redirectTo ' + redirects.length + ' 次');
  console.log('\n总计 PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}, 700);

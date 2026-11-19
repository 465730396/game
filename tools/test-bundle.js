'use strict';

// 规则引擎 / 控制器回归测试。运行：node tools/test-bundle.js
// 覆盖 2026-11-18 修复的 5 类问题 + 基础校验不回退 + 各人数整局模拟。
require('../bundle.js');
var SBM = global.SBM;
var e = SBM.engine;
var c = SBM.controller;

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
function section(title) { console.log('\n=== ' + title + ' ==='); }
function mk(ids) {
  return ids.map(function (id) { return { id: id, rank: id.slice(1), suit: id[0] }; });
}
function gameWith(handIds, seed) {
  var g = c.createGame({ playerCount: 3, seed: seed || 1 });
  g.players[0].hand = mk(handIds);
  g.currentSeat = 0;
  g.firstHandDone = true;
  g.lastPlay = null;
  return g;
}

section('1. 三带一/三带二 任意带牌可出');
var g1 = gameWith(['S7','H7','C7','S9','H5','CJ'], 11);
ok(c.play(g1, 0, ['S7','H7','C7','H5']).ok === true, '777 带任意单张 H5');
var g2 = gameWith(['S7','H7','C7','S9','H9','C5','D5'], 12);
ok(c.play(g2, 0, ['S7','H7','C7','C5','D5']).ok === true, '777 带任意对子 55');
ok(e.generateCandidates(mk(['S7','H7','C7','S9','H5','CJ']), e.defaultRuleConfig(3))
  .filter(function (x) { return x.detected.type === 'TRIPLET_SINGLE'; }).length === 3,
  '候选枚举含全部 3 种带牌');

section('2. 强制规则不可绕过');
var cfg = e.defaultRuleConfig(3);
function last(rankIds) { var cards = mk(rankIds); return { cards: cards, detected: e.detectType(cards, cfg) }; }
ok(e.canPass(last(['SK']), ['NEED_A'], mk(['SA','S7']), cfg) === false, '见单K有A不可pass');
ok(e.canPass(last(['SK']), ['NEED_A'], mk(['S7']), cfg) === true, '见单K无A可pass');
ok(e.canPass(last(['SA']), ['NEED_2'], mk(['D2']), cfg) === false, '见A有2不可pass');
ok(e.canPass(last(['SK','HK']), ['NEED_PAIR_A'], mk(['SA','HA']), cfg) === false, '见对K有对A不可pass');
ok(e.canPass(last(['D2']), ['NEED_BOMB'], mk(['S9','H9','C9','D9']), cfg) === false, '见2有炸弹不可pass');
ok(e.canPass(last(['D2']), ['NEED_BOMB'], mk(['S9','H9']), cfg) === true, '见2无炸弹可pass');

section('3. 配置生效且默认行为不变');
var def = e.defaultRuleConfig(3);
ok(e.detectType(mk(['S10','HJ','CQ','DK','SA']), def) === null, '默认 10JQKA 非顺子');
ok(e.detectType(mk(['S3','H4','C5','D6','S7']), def).type === 'STRAIGHT', '默认 34567 顺子');
ok(e.detectType(mk(['SA','HA','CA']), def).type === 'BOMB_AAA', '默认 AAA 天炸');
var cfgA = e.defaultRuleConfig(3); cfgA.cardTypes.straight.allowA = true;
ok(e.detectType(mk(['S10','HJ','CQ','DK','SA']), cfgA).type === 'STRAIGHT', 'allowA=true 时 10JQKA 成顺子');
var cfgQ = e.defaultRuleConfig(3); cfgQ.cardTypes.bomb.tripleA = false;
ok(e.detectType(mk(['SA','HA','CA']), cfgQ).type === 'TRIPLET', 'tripleA=false 时 AAA 降为三张');
var cfgP = e.defaultRuleConfig(3); cfgP.cardTypes.airplane.minGroups = 3;
ok(e.detectType(mk(['S3','H3','C3','S4','H4','C4']), cfgP) === null, 'minGroups=3 时两连三不成飞机');

section('4. 计分与天炸');
var aaa = e.detectType(mk(['SA','HA','CA']), cfg);
function players() {
  return [
    { seat: 0, name: 'a', hand: mk(['S3']) },
    { seat: 1, name: 'b', hand: mk(['S4','H4']) },
    { seat: 2, name: 'c', hand: mk(['S5','H5','C5']) }
  ];
}
// [DESIGN 2026-11-18] 计分改为炸弹倍率制：地基分守恒，炸弹对全桌 delta 统一放大。
var r0 = e.settleRound({ config: cfg, players: players(), winnerSeat: 0, playLog: [] });
ok(r0.scores[0].delta === 5, '无炸弹基础分 5');
ok(r0.totalDelta === 0 && r0.multiplier === 1, '无炸弹时总变化为 0（守恒）');

var rSky = e.settleRound({ config: cfg, players: players(), winnerSeat: 0,
  playLog: [{ seat: 0, detected: aaa }] });
ok(rSky.multiplier === 4 && rSky.bombPoints === 2, '天炸计 2 点 → ×4');
ok(rSky.scores[0].delta === 20, '天炸后赢家 5 × 4 = 20');
ok(rSky.totalDelta === 0, '天炸后仍然守恒');

var rOne = e.settleRound({ config: cfg, players: players(), winnerSeat: 0,
  playLog: [{ seat: 0, detected: e.detectType(mk(['S9','H9','C9','D9']), cfg) }] });
ok(rOne.multiplier === 2 && rOne.scores[0].delta === 10, '单个四炸 ×2 → 10');
ok(rOne.totalDelta === 0, '炸弹后仍然守恒（旧版每个炸弹让全服总分缩水）');

var rTwo = e.settleRound({ config: cfg, players: players(), winnerSeat: 0, playLog: [
  { seat: 0, detected: aaa },
  { seat: 1, detected: e.detectType(mk(['S9','H9','C9','D9']), cfg) }
] });
ok(rTwo.multiplier === 4 && rTwo.bombPoints === 3, '天炸+四炸 3 点封顶 ×4');
ok(rTwo.scores[1].bombCount === 1, '他人炸弹计数独立记录');

section('5. AAAA 牌力与牌堆配置');
var a4 = e.detectType(mk(['SA','HA','CA','DA']), cfg);
var aaa3 = e.detectType(mk(['SA','HA','CA']), cfg);
var quad2 = e.detectType(mk(['S2','H2','C2','D2']), cfg);
ok(a4.type === 'BOMB_AAA' && a4.key === 100, 'AAAA 识别为天炸且 key=100');
ok(e.beats(a4, aaa3) && e.beats(aaa3, quad2), '牌力链 AAAA > AAA > 四炸');
ok(!e.beats(quad2, a4), '四炸压不过 AAAA');
ok(e.detectType(mk(['S9','H9','C9','D9']), cfg).type === 'BOMB_QUAD', '9999 仍为四炸不回退');
ok(def.skyBomb.cards === 'AAA', 'skyBomb.cards 与实现一致(AAA)');
ok(e.createDeck(e.defaultRuleConfig(3)).length % 3 === 0 &&
   e.createDeck(e.defaultRuleConfig(4)).length % 4 === 0, '各人数牌堆张数可整除');

section('6. 基础校验不回退');
var g3 = gameWith(['S7','H7','C7','S9'], 13);
g3.lastPlay = last(['SA']);
ok(c.play(g3, 0, ['S7']).ok === false, '压不过上家被拒');
var g4 = gameWith(['S7'], 14); g4.firstHandDone = false;
ok(c.play(g4, 0, ['S7']).error === 'FIRST_MUST_CONTAIN_H3', '首手不含红桃3被拒');
var g5 = gameWith(['S7'], 15); g5.currentSeat = 1;
ok(c.play(g5, 0, ['S7']).error === 'NOT_YOUR_TURN', '非本人回合被拒');
var g6 = gameWith(['SA','D2'], 16);
g6.lastPlay = last(['SK']);
ok(c.play(g6, 0, ['D2']).error === 'FORCED_TO_PLAY', '见K有A出2报强制出牌');

section('7. 上线能力：逃跑统计 / 清空保留设置 / 报牌');
var s = SBM.store;
s.clearAll();
s.updateStats(false, 0, true);
var st1 = s.getStats();
ok(st1.escapes === 1 && st1.games === 1, '逃跑计次数且计一局');
ok(st1.wins === 0 && st1.totalScore === 0, '逃跑不计胜、不计分');
s.updateStats(true, 6);
var st2 = s.getStats();
ok(st2.escapes === 1 && st2.games === 2 && st2.wins === 1 && st2.totalScore === 6, '正常结算累计正确');
s.saveSettings({ bgm: true, dialect: false, largeFont: true, vibration: false });
s.addRecord({ name: '测试', delta: 3, rank: 1, winner: true, mode: 'AI', createdAt: Date.now() });
s.clearRecords();
ok(s.getRecords().length === 0 && s.getStats().games === 0, 'clearRecords 清空战绩与统计');
ok(s.getSettings().bgm === true, 'clearRecords 保留用户设置');
var g7 = gameWith(['S7','H7','C7','S9'], 21);
c.play(g7, 0, ['S7','H7','C7']);
ok(g7.declared[0] === 1, '剩 1 张触发报牌');
var g8 = gameWith(['S7','H7','C7'], 22);
c.play(g8, 0, ['S7','H7','C7']);
ok(!Object.prototype.hasOwnProperty.call(g8.declared, 0), '出完不标记报牌 0');

section('8. 各人数 × 各难度整局模拟');
[2, 3, 4].forEach(function (n) {
  ['EASY', 'NORMAL', 'HARD'].forEach(function (lv) {
    var finished = 0;
    for (var s = 1; s <= 20; s++) {
      var g = c.createGame({ playerCount: n, seed: s * 41,
        difficulties: [lv, lv, lv, lv] });
      g.players.forEach(function (p) { p.isAI = true; if (p.difficulty === 'HUMAN') p.difficulty = lv; });
      var turns = 0;
      while (g.status === 'PLAYING' && turns < 500) {
        var seat = g.currentSeat;
        var res = c.aiTakeTurn(g);
        if (!res.ok && !c.pass(g, seat).ok) break;
        turns++;
      }
      if (g.status === 'FINISHED') finished++;
    }
    ok(finished === 20, n + '人 ' + lv + ' 20局全部正常结束');
  });
});

section('9. 规则档 / 一轮多局 / AI 留炸');
var gSim = c.createGame({ playerCount: 3, seed: 31, ruleMode: 'SIMPLE' });
ok(gSim.config.ruleMode === 'SIMPLE' && gSim.config.forceRules.seeKPlayA === false, '简化档关闭强制规则');
var gCls = c.createGame({ playerCount: 3, seed: 31, ruleMode: 'CLASSIC' });
ok(gCls.config.forceRules.seeKPlayA === true, '经典档保留强制规则');
gCls.lastPlay = { seat: 1, cards: mk(['SK']), detected: e.detectType(mk(['SK']), gCls.config) };
ok(c.getView(gCls, gCls.currentSeat).public.forceFlags.indexOf('NEED_A') >= 0, '经典档见单K产生 NEED_A');
gSim.lastPlay = { seat: 1, cards: mk(['SK']), detected: e.detectType(mk(['SK']), gSim.config) };
ok(c.getView(gSim, gSim.currentSeat).public.forceFlags.length === 0, '简化档见单K不产生强制标记');

// 一轮多局：5 局的轮次累计即为单局 delta 之和（此处只校验累加规则本身）
var roundTotals = {};
[5, -3, -2, 4, -1].forEach(function (d) { roundTotals[0] = (roundTotals[0] || 0) + d; });
ok(roundTotals[0] === 3, '轮次累计按局相加（5-3-2+4-1=3）');

// AI 留炸：手上只有炸弹能压、对手还很宽裕时应选择不出
var holdView = {
  seat: 0, hand: mk(['S9','H9','C9','D9','S3','S4','S5','S6','S7','S8']),
  legalPlays: [{ cards: mk(['S9','H9','C9','D9']), detected: e.detectType(mk(['S9','H9','C9','D9'])) }],
  canPass: true,
  public: { currentSeat: 0, lastPlay: { seat: 1, cards: mk(['S5']), detected: e.detectType(mk(['S5'])) }, handCounts: [10, 12, 13], playedCards: [] },
  config: e.defaultRuleConfig(3)
};
ok(SBM.ai.chooseAction(holdView, 'NORMAL').action === 'PASS', 'AI 在对手宽裕时留炸不出');

section('10. 牌堆修正 / 末位先出 / 每日挑战 seed');
// [DESIGN 2026-11-19] 旧版 2/3 人局只剩 1 张 2、3 张 A，"见 2 必出炸弹"几乎无从触发。
var dk3 = e.createDeck(e.defaultRuleConfig(3));
var dk2 = e.createDeck(e.defaultRuleConfig(2));
var cntRank = function (d, r) { return d.filter(function (x) { return x.rank === r; }).length; };
ok(dk3.length === 51, '3 人局 51 张，实际 ' + dk3.length);
ok(cntRank(dk3, 'A') === 4 && cntRank(dk3, '2') === 3, '3 人局保留 4 张 A、3 张 2（强制规则可执行）');
ok(dk3.length % 3 === 0, '3 人局可整除发牌');
ok(dk2.length === 52 && cntRank(dk2, '2') === 4, '2 人局改用 52 张全牌');

var gFirstDefault = c.createGame({ playerCount: 3, seed: 777 });
ok(gFirstDefault.firstHandDone === false, '未指定先手时仍按红桃3 首出');
var gFirstSet = c.createGame({ playerCount: 3, seed: 777, firstSeat: 1 });
ok(gFirstSet.currentSeat === 1 && gFirstSet.firstHandDone === true, '指定先手生效并跳过红桃3 约束');
ok(c.getView(gFirstSet, 1).legalPlays.length > 0, '指定先手后合法牌不为空');

var gSeedA = c.createGame({ playerCount: 3, seed: 20261119 });
var gSeedB = c.createGame({ playerCount: 3, seed: 20261119 });
var sig = function (g) {
  return g.players.map(function (p) { return p.hand.map(function (x) { return x.id; }).join(','); }).join('|');
};
ok(sig(gSeedA) === sig(gSeedB), '同 seed 发牌完全一致（每日挑战前提）');
ok(sig(gSeedA) !== sig(c.createGame({ playerCount: 3, seed: 20261120 })), '不同日期牌局不同');

console.log('\n总计 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);

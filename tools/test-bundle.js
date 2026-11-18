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
ok(e.settleRound({ config: cfg, players: players(), winnerSeat: 0,
  playLog: [{ seat: 0, detected: aaa, firstHand: true }] }).scores[0].delta === 10, '首手AAA 5+5=10');
ok(e.settleRound({ config: cfg, players: players(), winnerSeat: 0,
  playLog: [{ seat: 0, detected: aaa, firstHand: false }] }).scores[0].delta === 7, '非首手AAA 5+2=7');
ok(e.settleRound({ config: cfg, players: players(), winnerSeat: 0, playLog: [] }).scores[0].delta === 5, '无炸弹基础计分 5');

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

console.log('\n总计 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);

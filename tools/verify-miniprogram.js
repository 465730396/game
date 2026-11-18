'use strict';

// 校验小程序工程结构完整性。运行：node tools/verify-miniprogram.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
function exists(p) { return fs.existsSync(path.join(root, p)); }
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); }
  catch (e) { return null; }
}

console.log('\n=== 1. 工程骨架 ===');
['app.js', 'app.json', 'app.wxss', 'sitemap.json'].forEach(function (f) {
  ok(exists(f), f + ' 存在');
});
ok(exists('project.config.json'), 'project.config.json 存在');
const projectCfg = readJSON('project.config.json');
ok(projectCfg && projectCfg.miniprogramRoot === './', 'miniprogramRoot 指向仓库根');

console.log('\n=== 2. app.json 页面注册 ===');
const appCfg = readJSON('app.json');
ok(!!appCfg, 'app.json 合法');
const pages = appCfg && appCfg.pages || [];
ok(pages.length === 6, '注册 6 个页面，实际 ' + pages.length);

console.log('\n=== 3. 每页四件套 ===');
pages.forEach(function (p) {
  ['.js', '.wxml', '.wxss', '.json'].forEach(function (ext) {
    ok(exists(p + ext), p + ext);
  });
});

console.log('\n=== 4. 页面 JSON 合法 ===');
pages.forEach(function (p) {
  ok(!!readJSON(p + '.json'), p + '.json 合法');
});

console.log('\n=== 5. WXML 标签配对（粗检）===');
pages.forEach(function (p) {
  const xml = fs.readFileSync(path.join(root, p + '.wxml'), 'utf8');
  // 排除自闭合标签（<switch ... />），只统计需要成对出现的容器标签
  const opens = (xml.match(/<(view|button|scroll-view|canvas)\b[^>]*?(?<!\/)>/g) || []).length;
  const closes = (xml.match(/<\/(view|button|scroll-view|canvas)>/g) || []).length;
  ok(opens === closes, p + '.wxml 主要标签配对 (' + opens + '/' + closes + ')');
});

console.log('\n=== 6. 核心逻辑与音频资源 ===');
ok(exists('bundle.js'), 'bundle.js 存在（唯一真相源，无副本）');
ok(!exists('core'), '不存在多余的 core/ 副本目录');
ok(!exists('miniprogram'), '不存在多余的 miniprogram/ 嵌套目录');
['play.wav', 'turn.wav', 'bomb.wav', 'bgm.wav'].forEach(function (f) {
  ok(exists('assets/audio/' + f), '音频 ' + f);
});
ok(exists('utils/audio.js') && exists('utils/fx.js'), '音频/特效模块存在');

console.log('\n=== 7. 关键能力接入检查 ===');
const gameJs = fs.readFileSync(path.join(root, 'pages/game/game.js'), 'utf8');
ok(/saveSnapshot/.test(gameJs) && /getSession/.test(gameJs), '断点续局已接入');
ok(/onShareAppMessage/.test(gameJs), '分享已接入');
ok(/onHide/.test(gameJs) && /onShow/.test(gameJs), '生命周期暂停/恢复已接入');
const allPagesHaveShare = pages.every(function (p) {
  return /onShareAppMessage/.test(fs.readFileSync(path.join(root, p + '.js'), 'utf8'));
});
ok(allPagesHaveShare, '所有页面均支持分享');

console.log('\n=== 8. H5 归档与入口引用 ===');
['index.html', 'app.js', 'fx.js', 'styles.css'].forEach(function (f) {
  ok(exists('h5/' + f), 'H5 ' + f + ' 已归档到 h5/');
});
const h5Html = fs.readFileSync(path.join(root, 'h5/index.html'), 'utf8');
ok(/src="\.\.\/bundle\.js"/.test(h5Html), 'H5 的 bundle.js 路径指向仓库根');
const entryJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
ok(/require\('\.\/bundle\.js'\)/.test(entryJs), '小程序入口直接 require 根 bundle.js');
ok(!/core\/bundle\.js|sync-core/.test(entryJs), '入口无残留 core/ 副本引用');

console.log('\n=== 9. 上线能力检查 ===');
const gameSrc = fs.readFileSync(path.join(root, 'pages/game/game.js'), 'utf8');
ok(/onExit/.test(gameSrc), '牌桌有退出入口');
ok(/recordEscape/.test(gameSrc), '退出记为逃跑');
ok(/autoSelectFirstHand/.test(gameSrc), '首手自动选中红桃3');
ok(/if \(this\.finished\) return;/.test(gameSrc), '结算防重复写入');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
ok(/recordEscape/.test(appSrc), 'app 暴露 recordEscape');
const bundleSrc = fs.readFileSync(path.join(root, 'bundle.js'), 'utf8');
ok(/function clearRecords/.test(bundleSrc) && /clearRecords: clearRecords/.test(bundleSrc), 'store 提供 clearRecords');
ok(/if \(escaped\)/.test(bundleSrc), 'updateStats 支持逃跑计数');
const resultSrc = fs.readFileSync(path.join(root, 'pages/result/result.js'), 'utf8');
ok(/reLaunch/.test(resultSrc), '结算返回首页用 reLaunch');
ok(/badgeText/.test(resultSrc), '结算角标区分胜负/赢家');
ok(/r\.level/.test(resultSrc) && /r\.mode/.test(resultSrc), '再来一局沿用原参数');
const statsSrc = fs.readFileSync(path.join(root, 'pages/stats/stats.js'), 'utf8');
ok(/clearRecords/.test(statsSrc) && !/clearAll\(\)/.test(statsSrc), '清空战绩不影响设置');
pages.forEach(function (p) {
  const wxml = fs.readFileSync(path.join(root, p + '.wxml'), 'utf8');
  ok(/large-font/.test(wxml), p + ' 支持大字模式');
});

console.log('\n总计 PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);

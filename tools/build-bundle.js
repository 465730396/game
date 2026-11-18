'use strict';

// 将小程序端的 CommonJS 核心模块打包为浏览器可直接加载的 bundle.js
// 运行：node tools/build-bundle.js
// 说明（2026-11-18）：
//   - 本目录的 bundle.js 是 H5 试玩版「实际运行」的文件，当前已包含多处 [FIX 2026-11-18] 修复。
//   - 这些修复最初直接打在 bundle.js 上（因为 ../shengbei-laomazi/utils 源目录当前不存在），
//     尚未回填到小程序源码。因此构建脚本增加了一道保护：若源模块缺少这些修复，拒绝覆盖，
//     避免一次误构建把已修复的 bundle.js 打回旧版本。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, '..', 'shengbei-laomazi', 'utils');
const bundlePath = path.join(root, 'bundle.js');
const modules = ['rule-engine.js', 'ai.js', 'game-controller.js', 'store.js'];
const FIX_TAG = '[FIX 2026-11-18]';

function wrap(name, code) {
  return "  __define('" + name + "', function(module, exports, require){\n" + code + "\n  });";
}

function die(msg) {
  console.error('\n[build-bundle] 构建中止：\n' + msg + '\n');
  process.exit(1);
}

// 1) 源目录必须存在
if (!fs.existsSync(sourceDir)) {
  die(
    '找不到小程序源码目录：' + sourceDir + '\n' +
    '  bundle.js 已是本 H5 试玩版的真相源（含 ' + FIX_TAG + ' 修复），无需重新构建。\n' +
    '  如需同步，请先把小程序源码放到上述路径，确认其中已包含 ' + FIX_TAG + ' 修复后再构建。'
  );
}

// 2) 逐个模块检查，避免读文件时抛出晦涩的 ENOENT
var missing = modules.filter(function (f) { return !fs.existsSync(path.join(sourceDir, f)); });
if (missing.length) {
  die('源目录缺少以下模块：' + missing.join(', ') + '\n  路径：' + sourceDir);
}

// 3) 拼装产物
var out = "(function(global){\n" +
  "  var __modules = {};\n" +
  "  function __define(name, factory){\n" +
  "    var module = {exports:{}};\n" +
  "    __modules[name] = module.exports;\n" +
  "    factory(module, module.exports, function(id){\n" +
  "      var key = String(id).replace(/^\\.\\//, '').replace(/\\.js$/, '');\n" +
  "      if(!__modules[key]) throw new Error('module not found: ' + id);\n" +
  "      return __modules[key];\n" +
  "    });\n" +
  "    __modules[name] = module.exports;\n" +
  "  }\n";

modules.forEach(function (file) {
  const code = fs.readFileSync(path.join(sourceDir, file), 'utf8');
  out += wrap(file.replace(/\.js$/, ''), code) + "\n";
});

out += "  global.SBM = {\n" +
  "    engine: __modules['rule-engine'],\n" +
  "    ai: __modules['ai'],\n" +
  "    controller: __modules['game-controller'],\n" +
  "    store: __modules['store']\n" +
  "  };\n" +
  "})(typeof window !== 'undefined' ? window : globalThis);\n";

// 4) 覆盖保护：产物若丢失已落地的修复标记，拒绝写入
if (fs.existsSync(bundlePath)) {
  var current = fs.readFileSync(bundlePath, 'utf8');
  var currentFixCount = (current.match(/\[FIX 2026-11-18\]/g) || []).length;
  var nextFixCount = (out.match(/\[FIX 2026-11-18\]/g) || []).length;
  if (currentFixCount > nextFixCount) {
    if (process.argv.indexOf('--force') < 0) {
      die(
        '检测到当前 bundle.js 含 ' + currentFixCount + ' 处 ' + FIX_TAG + ' 修复，\n' +
        '  而源模块生成的产物只有 ' + nextFixCount + ' 处。直接覆盖会丢失这些修复。\n' +
        '  请先把 bundle.js 中的修复回填到 ../shengbei-laomazi/utils 源码；\n' +
        '  若确认要用源码覆盖（丢弃修复），请加 --force 参数重试。'
      );
    }
    console.warn('[build-bundle] 警告：--force 已指定，将覆盖 ' + currentFixCount + ' 处本地修复。');
  }
}

fs.writeFileSync(bundlePath, out, 'utf8');
console.log('bundle.js generated, bytes=' + Buffer.byteLength(out) +
  ', ' + FIX_TAG + ' markers=' + (out.match(/\[FIX 2026-11-18\]/g) || []).length);

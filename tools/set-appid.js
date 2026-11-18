'use strict';

// 一键替换 AppID。上传代码、真机预览都必须用真实 AppID，touristappid 只能跑模拟器。
// 运行：node tools/set-appid.js wx1234567890abcdef
// 查看位置：小程序后台 → 开发管理 → 开发设置 → AppID(小程序ID)
const fs = require('fs');
const path = require('path');

const id = (process.argv[2] || '').trim();
if (!/^wx[0-9a-zA-Z]{16}$/.test(id)) {
  console.error('用法：node tools/set-appid.js <AppID>');
  console.error('AppID 形如 wx1234567890abcdef（wx 开头共 18 位）');
  process.exit(1);
}

const file = path.resolve(__dirname, '..', 'project.config.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const old = cfg.appid;
cfg.appid = id;
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('project.config.json  appid: ' + old + '  →  ' + id);
console.log('重新用微信开发者工具打开仓库根目录即可真机预览/上传。');

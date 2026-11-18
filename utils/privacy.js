'use strict';

// 小程序隐私协议 + 相册授权封装。
//
// 背景（这是提交审核前最容易踩的坑）：
// 2023-09 起，调用 saveImageToPhotosAlbum 等隐私接口前，用户必须先在
// 《小程序用户隐私保护指引》上点"同意"，否则 API 直接返回 errno 112，
// errMsg 为 "privacy permission is not authorized"。这不是相册权限不足，
// 反复调 openSetting 也没用——旧实现只判断 auth/deny，会把它当成普通失败，
// 玩家点十次也存不下来，也不知道为什么。
//
// 另一个坑：requirePrivacyAuthorize 必须在用户手势的同步链路里调用。
// 必须"先要隐私授权，再画 canvas"；如果等 canvasToTempFilePath 回调里再弹，
// 手势上下文已经丢了，弹窗拉不起来。

function ensurePrivacy(cb) {
  if (typeof wx.getPrivacySetting !== 'function') { cb(true); return; }
  wx.getPrivacySetting({
    success: function (res) {
      if (!res || !res.needAuthorization) { cb(true); return; }
      if (typeof wx.requirePrivacyAuthorize !== 'function') { cb(false); return; }
      wx.requirePrivacyAuthorize({
        success: function () { cb(true); },
        fail: function () { cb(false); }
      });
    },
    // 查询失败不阻塞主流程，交给 saveImage 的失败分流兜底
    fail: function () { cb(true); }
  });
}

function classify(err) {
  var msg = (err && (err.errMsg || err.message)) || '';
  if (msg.indexOf('privacy') >= 0) return 'privacy';
  if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authDeny') >= 0 ||
      msg.indexOf('authorize') >= 0 || msg.indexOf('auth denied') >= 0) return 'denied';
  if (msg.indexOf('system') >= 0) return 'system';
  return 'other';
}

// 保存到相册。cb(ok, reason, errMsg)，reason 为 privacy / denied / system / other
function saveImage(filePath, cb) {
  ensurePrivacy(function (agreed) {
    if (!agreed) { cb(false, 'privacy', 'privacy permission is not authorized'); return; }
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: function () { cb(true, '', ''); },
      fail: function (err) {
        cb(false, classify(err), (err && (err.errMsg || err.message)) || '');
      }
    });
  });
}

// 相册授权被拒后的引导；返回是否已开启
function openAlbumSetting(cb) {
  wx.openSetting({
    success: function (res) {
      cb(!!(res && res.authSetting && res.authSetting['scope.writePhotosAlbum']));
    },
    fail: function () { cb(false); }
  });
}

// 按失败原因给出可执行的提示，避免"存不下来但不知道为什么"
function explain(reason) {
  if (reason === 'privacy') {
    return {
      title: '需先同意隐私协议',
      content: '保存战绩图属于隐私接口，需先同意《用户隐私保护指引》。可在「设置 → 隐私」中查看。',
      confirmText: '去设置'
    };
  }
  if (reason === 'denied') {
    return {
      title: '需要相册权限',
      content: '保存战绩图需要「添加到相册」权限，可在设置页开启后重试。',
      confirmText: '去设置'
    };
  }
  if (reason === 'system') {
    return {
      title: '系统未授权相册',
      content: '微信没有系统相册权限。请到手机「设置 → 微信 → 照片」中允许访问后重试。',
      confirmText: '知道了'
    };
  }
  return {
    title: '保存失败',
    content: '可先预览图片，长按保存到相册。',
    confirmText: '预览'
  };
}

module.exports = {
  ensurePrivacy: ensurePrivacy,
  saveImage: saveImage,
  openAlbumSetting: openAlbumSetting,
  explain: explain
};

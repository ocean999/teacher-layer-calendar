// 实时在线检查更新与一键热更新模块
// 支持两种更新源：
// 1. GitHub Releases API（如填写 owner/repo，例如 yourname/teacher-layer-calendar）
// 2. 自定义 JSON 清单 URL（返回 { version, notes, downloadUrl }）

const fs = require('fs');
const path = require('path');
const os = require('os');
const extract = require('extract-zip');

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdates(updateCfg = {}, currentVersion = '1.1.0') {
  const source = (updateCfg.sourceUrl || '').trim();
  if (!source) {
    return {
      ok: true,
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      configured: false,
      message: '尚未配置在线更新源（可在下方填写你的 GitHub 仓库如 owner/repo 或 version.json 地址）。',
    };
  }

  try {
    let latestVersion = currentVersion;
    let notes = '';
    let downloadUrl = '';
    let releasePage = '';

    if (/^[\w.-]+\/[\w.-]+$/.test(source)) {
      // GitHub owner/repo 格式
      const apiUrl = `https://api.github.com/repos/${source}/releases/latest`;
      const res = await fetch(apiUrl, { headers: { 'User-Agent': 'TeacherLayerCalendar-Updater' } });
      if (res.status === 404) {
        return { ok: true, hasUpdate: false, configured: true, currentVersion, latestVersion: currentVersion, message: '该仓库暂未发布任何 Release 版本。' };
      }
      if (!res.ok) throw new Error(`GitHub 接口返回 HTTP ${res.status}`);
      const json = await res.json();
      latestVersion = (json.tag_name || json.name || currentVersion).replace(/^v/i, '');
      notes = json.body || '常规功能优化与问题修复';
      releasePage = json.html_url || '';
      // 优先使用轻量级源码 zipball（仅约 100KB，2秒完成热更新），同时支持显式 hot-update zip 附件
      const hotZip = (json.assets || []).find((a) => /hot[-_]?update.*\.zip$/i.test(a.name));
      downloadUrl = hotZip ? hotZip.browser_download_url : (json.zipball_url || '');
    } else {
      // 自定义 JSON 更新清单 URL
      const res = await fetch(source, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`更新清单返回 HTTP ${res.status}`);
      const json = await res.json();
      latestVersion = String(json.version || currentVersion).replace(/^v/i, '');
      notes = json.notes || json.changelog || '';
      downloadUrl = json.downloadUrl || json.zipUrl || '';
      releasePage = json.pageUrl || source;
    }

    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    return {
      ok: true,
      configured: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      notes,
      downloadUrl,
      releasePage,
      checkedAt: Date.now(),
      message: hasUpdate ? `发现新版本 v${latestVersion}（当前 v${currentVersion}）` : `当前已是最新版本 v${currentVersion}`,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      hasUpdate: false,
      currentVersion,
      message: `检查更新失败：${err.message}`,
    };
  }
}

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sPath = path.join(src, entry.name);
    const dPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(sPath, dPath);
    } else {
      fs.copyFileSync(sPath, dPath);
    }
  }
}

async function applyOneClickUpdate(downloadUrl, appRoot) {
  if (!downloadUrl) {
    return { ok: false, message: '未找到可用的更新包下载链接。' };
  }
  const tmpDir = path.join(os.tmpdir(), `teachercal-update-${Date.now()}`);
  const zipPath = path.join(tmpDir, 'update.zip');
  const extractDir = path.join(tmpDir, 'extracted');

  try {
    fs.mkdirSync(extractDir, { recursive: true });
    const res = await fetch(downloadUrl, { headers: { 'User-Agent': 'TeacherLayerCalendar-Updater' } });
    if (!res.ok) throw new Error(`下载更新包失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    await extract(zipPath, { dir: extractDir });

    // GitHub zipball 会包一层顶层目录，自动探测包含 shared/web 和 desktop 的目录
    let payloadRoot = extractDir;
    if (!fs.existsSync(path.join(payloadRoot, 'shared'))) {
      const subDirs = fs.readdirSync(extractDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const d of subDirs) {
        const candidate = path.join(extractDir, d.name);
        if (fs.existsSync(path.join(candidate, 'shared')) || fs.existsSync(path.join(candidate, 'desktop'))) {
          payloadRoot = candidate;
          break;
        }
      }
    }

    if (!fs.existsSync(path.join(payloadRoot, 'shared')) && !fs.existsSync(path.join(payloadRoot, 'desktop'))) {
      throw new Error('更新包结构不匹配（缺少 shared/ 或 desktop/ 目录），已安全中止覆盖。');
    }

    // 仅覆盖代码目录，绝不触碰 %APPDATA% 中的个人课表与坚果云配置
    if (fs.existsSync(path.join(payloadRoot, 'shared', 'web'))) {
      copyDirRecursive(path.join(payloadRoot, 'shared', 'web'), path.join(appRoot, 'shared', 'web'));
    }
    if (fs.existsSync(path.join(payloadRoot, 'desktop'))) {
      copyDirRecursive(path.join(payloadRoot, 'desktop'), path.join(appRoot, 'desktop'));
    }
    if (fs.existsSync(path.join(payloadRoot, 'package.json'))) {
      fs.copyFileSync(path.join(payloadRoot, 'package.json'), path.join(appRoot, 'package.json'));
    }

    return { ok: true, message: '更新包已应用成功，即将自动重启日历生效！' };
  } catch (err) {
    return { ok: false, message: `一键更新失败：${err.message}` };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = {
  compareSemver,
  checkForUpdates,
  applyOneClickUpdate,
};

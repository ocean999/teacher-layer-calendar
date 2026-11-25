// 实时在线检查更新与一键热更新模块
// 支持两种更新源：
// 1. GitHub 仓库（owner/repo 或 https://github.com/owner/repo）：优先走网页/Atom/Archive 直连通道，彻底绕开 api.github.com 60次/小时 HTTP 403 限流
// 2. 自定义 JSON 清单 URL（返回 { version, notes, downloadUrl }）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const extract = require('extract-zip');

const UPDATER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TeacherLayerCalendar-Updater/1.5.5';

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function stripHtmlToText(rawHtml) {
  return String(rawHtml || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeGitHubSlug(source) {
  const raw = String(source || '').trim();
  const fullM = raw.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git|\/)?$/i);
  if (fullM) return fullM[1];
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return raw;
  return null;
}

async function checkGitHubWithoutApiRateLimit(repoSlug, currentVersion) {
  const [latestRes, atomRes] = await Promise.all([
    fetch(`https://github.com/${repoSlug}/releases/latest`, {
      redirect: 'follow',
      headers: { 'User-Agent': UPDATER_UA, Accept: 'text/html', 'Cache-Control': 'no-cache' },
    }).catch(() => null),
    fetch(`https://github.com/${repoSlug}/releases.atom`, {
      headers: { 'User-Agent': UPDATER_UA, 'Cache-Control': 'no-cache' },
    }).catch(() => null),
  ]);

  let rawTag = '';
  if (latestRes && latestRes.ok) {
    const tagM = String(latestRes.url || '').match(/\/releases\/tag\/([^/?#]+)/);
    if (tagM) rawTag = decodeURIComponent(tagM[1]);
  }

  let atomText = '';
  if (atomRes && atomRes.ok) {
    atomText = await atomRes.text();
    if (!rawTag) {
      const atomTagM = atomText.match(/releases\/tag\/([^<"'?\s]+)/);
      if (atomTagM) rawTag = decodeURIComponent(atomTagM[1]);
    }
  }

  if (rawTag) {
    const latestVersion = rawTag.replace(/^v/i, '');
    let notes = '';
    const firstEntryM = atomText.match(/<entry>[\s\S]*?<\/entry>/);
    if (firstEntryM) {
      const contentM = firstEntryM[0].match(/<content[^>]*>([\s\S]*?)<\/content>/);
      const titleM = firstEntryM[0].match(/<title[^>]*>([\s\S]*?)<\/title>/);
      notes = stripHtmlToText(contentM ? contentM[1] : (titleM ? titleM[1] : ''));
    }
    return {
      ok: true,
      hasRelease: true,
      latestVersion,
      notes: notes || '常规功能优化与问题修复',
      releasePage: `https://github.com/${repoSlug}/releases/tag/${encodeURIComponent(rawTag)}`,
      downloadUrl: `https://github.com/${repoSlug}/archive/refs/tags/${encodeURIComponent(rawTag)}.zip`,
    };
  }

  // 回退读取 raw.githubusercontent.com 上的 main/package.json（同样无限流）
  const pkgRes = await fetch(`https://raw.githubusercontent.com/${repoSlug}/main/package.json`, {
    headers: { 'User-Agent': UPDATER_UA, 'Cache-Control': 'no-cache' },
  }).catch(() => null);
  if (pkgRes && pkgRes.ok) {
    const pkg = await pkgRes.json().catch(() => null);
    if (pkg && pkg.version) {
      return {
        ok: true,
        hasRelease: true,
        latestVersion: String(pkg.version).replace(/^v/i, ''),
        notes: '源码最新主干版本（GitHub 直连同步）',
        releasePage: `https://github.com/${repoSlug}/releases`,
        downloadUrl: `https://github.com/${repoSlug}/archive/refs/heads/main.zip`,
      };
    }
  }

  if (latestRes && latestRes.status === 404) {
    return {
      ok: true,
      hasRelease: false,
      latestVersion: currentVersion,
      notes: '',
      releasePage: `https://github.com/${repoSlug}/releases`,
      downloadUrl: '',
    };
  }

  throw new Error('直连 GitHub 发布页暂不可达');
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

    const repoSlug = normalizeGitHubSlug(source);
    if (repoSlug) {
      try {
        const direct = await checkGitHubWithoutApiRateLimit(repoSlug, currentVersion);
        if (!direct.hasRelease) {
          return { ok: true, hasUpdate: false, configured: true, currentVersion, latestVersion: currentVersion, message: '该仓库暂未发布任何 Release 版本。' };
        }
        latestVersion = direct.latestVersion;
        notes = direct.notes;
        downloadUrl = direct.downloadUrl;
        releasePage = direct.releasePage;
      } catch (directErr) {
        // 仅在网页/Atom/Raw 全部网络失败时，最后兜底请求 GitHub REST API
        const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/latest`;
        const res = await fetch(apiUrl, { headers: { 'User-Agent': UPDATER_UA } });
        if (res.status === 404) {
          return { ok: true, hasUpdate: false, configured: true, currentVersion, latestVersion: currentVersion, message: '该仓库暂未发布任何 Release 版本。' };
        }
        if (!res.ok) throw new Error(`GitHub 接口返回 HTTP ${res.status}（${directErr.message}）`);
        const json = await res.json();
        const tag = json.tag_name || json.name || '';
        latestVersion = tag.replace(/^v/i, '') || currentVersion;
        notes = json.body || '常规功能优化与问题修复';
        releasePage = json.html_url || '';
        const hotZip = (json.assets || []).find((a) => /hot[-_]?update.*\.zip$/i.test(a.name));
        downloadUrl = hotZip ? hotZip.browser_download_url : (tag ? `https://github.com/${repoSlug}/archive/refs/tags/${encodeURIComponent(tag)}.zip` : (json.zipball_url || ''));
      }
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

async function extractZipArchive(zipPath, extractDir) {
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'pipe', windowsHide: true });
    if (fs.readdirSync(extractDir).length > 0) return;
  } catch {}
  if (process.platform === 'win32') {
    try {
      execFileSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
      ], { stdio: 'pipe', windowsHide: true });
      if (fs.readdirSync(extractDir).length > 0) return;
    } catch {}
  }
  await Promise.race([
    extract(zipPath, { dir: extractDir }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('解压更新包超时，请稍后重试')), 15000)),
  ]);
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
    const res = await fetch(downloadUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': UPDATER_UA },
    });
    if (!res.ok) throw new Error(`下载更新包失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    await extractZipArchive(zipPath, extractDir);

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

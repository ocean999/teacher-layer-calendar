// 免装 Git 一键上传到你的 GitHub 仓库（通过 GitHub 官方 REST API）
// 用法：node scripts/upload-to-github.js <GITHUB_TOKEN> [REPO_NAME=teacher-layer-calendar] [--private]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.gradle', 'build']);
const IGNORE_FILES = new Set(['Thumbs.db', '.DS_Store', 'sample_timetable.png']);

function collectFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(path.join(dir, entry.name), path.posix.join(base, entry.name)));
    } else {
      if (IGNORE_FILES.has(entry.name) || entry.name.endsWith('.log')) continue;
      out.push({ abs: path.join(dir, entry.name), rel: path.posix.join(base, entry.name) });
    }
  }
  return out;
}

async function ghApi(token, method, endpoint, body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TeacherLayerCalendar-Uploader',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  const token = process.argv[2] || process.env.GITHUB_TOKEN;
  const repoName = process.argv[3] || 'teacher-layer-calendar';
  const isPrivate = process.argv.includes('--private');

  if (!token) {
    console.error('用法：node scripts/upload-to-github.js <GITHUB_TOKEN> [仓库名] [--private]');
    process.exit(1);
  }

  const me = await ghApi(token, 'GET', '/user');
  if (!me.ok) throw new Error(`GitHub Token 校验失败（HTTP ${me.status}）：${me.json?.message || me.text}`);
  const owner = me.json.login;
  console.log(`✅ 已登录 GitHub 账号：${owner}`);

  // 检查或创建仓库
  let repo = await ghApi(token, 'GET', `/repos/${owner}/${repoName}`);
  if (repo.status === 404) {
    console.log(`📦 正在创建仓库 ${owner}/${repoName}（${isPrivate ? '私有' : '公开'}）...`);
    repo = await ghApi(token, 'POST', '/user/repos', {
      name: repoName,
      description: PKG.description,
      private: isPrivate,
      auto_init: true,
    });
    if (!repo.ok) throw new Error(`创建仓库失败：${repo.json?.message || repo.text}`);
  } else if (!repo.ok) {
    throw new Error(`访问仓库失败：${repo.json?.message || repo.text}`);
  }
  const branch = repo.json.default_branch || 'main';
  console.log(`✅ 目标仓库就绪：https://github.com/${owner}/${repoName} (分支: ${branch})`);

  // 获取最新提交 SHA
  let ref = await ghApi(token, 'GET', `/repos/${owner}/${repoName}/git/ref/heads/${branch}`);
  if (!ref.ok) throw new Error(`读取分支失败：${ref.json?.message || ref.text}`);
  const parentSha = ref.json.object.sha;
  const parentCommit = await ghApi(token, 'GET', `/repos/${owner}/${repoName}/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.json.tree.sha;

  // 上传所有项目文件为 blob
  const files = collectFiles(ROOT);
  console.log(`🚀 正在上传 ${files.length} 个源码与工程文件...`);
  const treeEntries = [];
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const blob = await ghApi(token, 'POST', `/repos/${owner}/${repoName}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    if (!blob.ok) throw new Error(`上传文件 ${f.rel} 失败：${blob.json?.message || blob.text}`);
    treeEntries.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.json.sha });
  }

  const tree = await ghApi(token, 'POST', `/repos/${owner}/${repoName}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });
  if (!tree.ok) throw new Error(`创建文件树失败：${tree.json?.message || tree.text}`);

  const commit = await ghApi(token, 'POST', `/repos/${owner}/${repoName}/git/commits`, {
    message: `Release v${PKG.version}: Windows 桌面版与 Android APK 源码及自动发版工作流`,
    tree: tree.json.sha,
    parents: [parentSha],
  });
  if (!commit.ok) throw new Error(`创建提交失败：${commit.json?.message || commit.text}`);

  const updRef = await ghApi(token, 'PATCH', `/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    sha: commit.json.sha,
    force: false,
  });
  if (!updRef.ok) throw new Error(`更新分支失败：${updRef.json?.message || updRef.text}`);

  // 打 tag v1.3.0 以自动触发 GitHub Actions 编译 Windows + Android APK 并发布 Release！
  const tagName = `v${PKG.version}`;
  await ghApi(token, 'POST', `/repos/${owner}/${repoName}/git/refs`, {
    ref: `refs/tags/${tagName}`,
    sha: commit.json.sha,
  });

  console.log(`\n🎉 上传成功！`);
  console.log(`   仓库主页：https://github.com/${owner}/${repoName}`);
  console.log(`   自动打包进度（约 2 分钟生成 Windows 版与 Android APK）：`);
  console.log(`   https://github.com/${owner}/${repoName}/actions`);
  console.log(`   在软件「⚙ 设置 → 在线检查更新」中填入更新源：${owner}/${repoName}`);
}

main().catch((e) => {
  console.error('❌ 上传失败：', e.message);
  process.exit(1);
});

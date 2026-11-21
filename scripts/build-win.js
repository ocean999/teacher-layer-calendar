// 打包生成 Windows 独立绿色免安装版（教师双图层日历.exe + 压缩包）并同步安卓前端资源
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_DIR = path.join(DIST_DIR, 'TeacherLayerCalendar-win-x64');
const APP_DIR = path.join(OUT_DIR, 'resources', 'app');
const ANDROID_WEB = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'web');
const ZIP_OUT = path.join(DIST_DIR, `TeacherLayerCalendar-v${PKG.version}-Windows-x64.zip`);

function copyDir(src, dst, filterFn = null) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (filterFn && !filterFn(s, entry.name, entry.isDirectory())) continue;
    if (entry.isDirectory()) copyDir(s, d, filterFn);
    else fs.copyFileSync(s, d);
  }
}

console.log(`[1/4] 同步 shared/web -> android/app/src/main/assets/web ...`);
fs.rmSync(ANDROID_WEB, { recursive: true, force: true });
copyDir(path.join(ROOT, 'shared', 'web'), ANDROID_WEB);

if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  throw new Error('未找到 node_modules/electron/dist/electron.exe，请先执行 npm install。');
}

console.log(`[2/4] 复制 Electron 运行时到 ${OUT_DIR} ...`);
fs.rmSync(OUT_DIR, { recursive: true, force: true });
copyDir(ELECTRON_DIST, OUT_DIR);

// 移除默认示例包，写入我们的应用代码
const defaultAsar = path.join(OUT_DIR, 'resources', 'default_app.asar');
if (fs.existsSync(defaultAsar)) fs.rmSync(defaultAsar, { force: true });

// 重命名主可执行文件
fs.renameSync(path.join(OUT_DIR, 'electron.exe'), path.join(OUT_DIR, '教师双图层日历.exe'));

console.log(`[3/4] 写入应用代码与运行时依赖 ...`);
fs.mkdirSync(APP_DIR, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP_DIR, 'package.json'));
copyDir(path.join(ROOT, 'desktop'), path.join(APP_DIR, 'desktop'));
copyDir(path.join(ROOT, 'shared', 'web'), path.join(APP_DIR, 'shared', 'web'));

// 复制运行时所需的 node_modules（排除体积庞大的 electron/@electron）
const excludeTop = new Set(['electron', '@electron', '.bin', '.cache']);
copyDir(path.join(ROOT, 'node_modules'), path.join(APP_DIR, 'node_modules'), (full, name) => {
  const rel = path.relative(path.join(ROOT, 'node_modules'), full);
  const top = rel.split(path.sep)[0];
  return !excludeTop.has(top);
});

// 附带双格式课表模板与说明文档到绿色版根目录，方便用户开箱即用
['教师课表导入模板.xlsx', '教师课表导入模板.docx', 'README.md'].forEach((f) => {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, f));
});

console.log(`[4/4] 打包 Windows 便携压缩包 -> ${ZIP_OUT} ...`);
if (fs.existsSync(ZIP_OUT)) fs.rmSync(ZIP_OUT, { force: true });
execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${OUT_DIR}\\*' -DestinationPath '${ZIP_OUT}' -Force`,
], { stdio: 'inherit' });

const stat = fs.statSync(ZIP_OUT);
console.log(`\n✅ Windows 绿色独立版打包完成！`);
console.log(`   可执行程序: ${path.join(OUT_DIR, '教师双图层日历.exe')}`);
console.log(`   压缩发布包: ${ZIP_OUT} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

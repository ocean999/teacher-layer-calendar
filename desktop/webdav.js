// 坚果云 WebDAV 客户端与四文件无损合并引擎（基于 Node.js 内置 fetch，零外部依赖）
// 同步文件：timetable.json（我的课表）、overrides.json（单次调课）、works.json（顶层干活）、class_timetable.json（班主任班级课表）

function normalizeBaseUrl(url) {
  let u = (url || 'https://dav.jianguoyun.com/dav/').trim();
  if (!u.endsWith('/')) u += '/';
  return u;
}

function buildAuthHeader(username, password) {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function buildFolderUrl(cfg) {
  const base = normalizeBaseUrl(cfg.serverUrl);
  const folder = (cfg.folder || 'TeacherCal').trim().replace(/^\/+|\/+$/g, '');
  return folder ? `${base}${encodeURIComponent(folder)}/` : base;
}

async function davRequest(cfg, url, method, body = null, extraHeaders = {}) {
  if (!cfg.username || !cfg.password) {
    throw new Error('请先填写坚果云账号和第三方应用密码（同步码）');
  }
  const headers = {
    Authorization: buildAuthHeader(cfg.username.trim(), cfg.password.trim()),
    ...extraHeaders,
  };
  const opts = { method, headers };
  if (body !== null && body !== undefined) opts.body = body;
  return fetch(url, opts);
}

async function testConnection(cfg) {
  const base = normalizeBaseUrl(cfg.serverUrl);
  try {
    const res = await davRequest(cfg, base, 'PROPFIND', null, { Depth: '0' });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: '认证失败（401）：请检查坚果云账号，并确认填写的是“第三方应用密码（同步码）”而非登录密码。' };
    }
    if (res.status >= 200 && res.status < 300) {
      await ensureFolder(cfg);
      return { ok: true, message: '连接成功！已在坚果云确认同步目录。' };
    }
    return { ok: false, message: `服务器返回异常状态码：HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: `网络请求失败：${err.message}` };
  }
}

async function ensureFolder(cfg) {
  const folderUrl = buildFolderUrl(cfg);
  const res = await davRequest(cfg, folderUrl, 'MKCOL');
  if ([200, 201, 204, 301, 405].includes(res.status)) return true;
  if (res.status === 401 || res.status === 403) throw new Error('坚果云认证失败（401），请检查应用密码');
  throw new Error(`创建坚果云目录失败：HTTP ${res.status}`);
}

async function getJsonFile(cfg, filename) {
  const url = buildFolderUrl(cfg) + encodeURIComponent(filename);
  const res = await davRequest(cfg, url, 'GET');
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error('坚果云认证失败（401），请检查应用密码');
  if (!res.ok) throw new Error(`读取 ${filename} 失败：HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function putJsonFile(cfg, filename, data) {
  const url = buildFolderUrl(cfg) + encodeURIComponent(filename);
  const body = JSON.stringify(data, null, 2);
  const res = await davRequest(cfg, url, 'PUT', body, { 'Content-Type': 'application/json; charset=utf-8' });
  if (res.status === 401 || res.status === 403) throw new Error('坚果云认证失败（401），请检查应用密码');
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`写入 ${filename} 失败：HTTP ${res.status}`);
  return true;
}

function mergeItemList(localArr = [], remoteArr = []) {
  const map = new Map();
  for (const item of remoteArr) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of localArr) {
    if (!item || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt || 0) >= (prev.updatedAt || 0)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

function mergeTimetable(localTt = {}, remoteTt = null) {
  if (!remoteTt) return localTt;
  const mergedCourses = mergeItemList(localTt.courses || [], remoteTt.courses || []);
  const localMetaTs = localTt.metaUpdatedAt || 0;
  const remoteMetaTs = remoteTt.metaUpdatedAt || 0;
  const newerMeta = localMetaTs >= remoteMetaTs ? localTt : remoteTt;
  return {
    termStartDate: newerMeta.termStartDate || localTt.termStartDate || '2026-09-01',
    periods: newerMeta.periods || localTt.periods || [],
    metaUpdatedAt: Math.max(localMetaTs, remoteMetaTs),
    courses: mergedCourses,
  };
}

function mergeClassTimetable(localCt = {}, remoteCt = null) {
  if (!remoteCt) return localCt;
  const localTs = localCt.metaUpdatedAt || 0;
  const remoteTs = remoteCt.metaUpdatedAt || 0;
  const newer = localTs >= remoteTs ? localCt : remoteCt;
  return {
    className: newer.className || localCt.className || '902班',
    metaUpdatedAt: Math.max(localTs, remoteTs),
    courses: mergeItemList(localCt.courses || [], remoteCt.courses || []),
    overrides: mergeItemList(localCt.overrides || [], remoteCt.overrides || []),
  };
}

async function syncAll(cfg, localData) {
  await ensureFolder(cfg);

  const [remoteTt, remoteOv, remoteWk, remoteCt] = await Promise.all([
    getJsonFile(cfg, 'timetable.json'),
    getJsonFile(cfg, 'overrides.json'),
    getJsonFile(cfg, 'works.json'),
    getJsonFile(cfg, 'class_timetable.json'),
  ]);

  const mergedTimetable = mergeTimetable(localData.timetable || {}, remoteTt);
  const mergedOverrides = mergeItemList(localData.overrides || [], (remoteOv && remoteOv.items) || []);
  const mergedWorks = mergeItemList(localData.works || [], (remoteWk && remoteWk.items) || []);
  const mergedClassTt = mergeClassTimetable(localData.classTimetable || {}, remoteCt);

  const now = Date.now();
  await Promise.all([
    putJsonFile(cfg, 'timetable.json', mergedTimetable),
    putJsonFile(cfg, 'overrides.json', { updatedAt: now, items: mergedOverrides }),
    putJsonFile(cfg, 'works.json', { updatedAt: now, items: mergedWorks }),
    putJsonFile(cfg, 'class_timetable.json', mergedClassTt),
  ]);

  return {
    timetable: mergedTimetable,
    overrides: mergedOverrides,
    works: mergedWorks,
    classTimetable: mergedClassTt,
    syncedAt: now,
  };
}

module.exports = {
  testConnection,
  ensureFolder,
  syncAll,
  mergeItemList,
  mergeTimetable,
  mergeClassTimetable,
};

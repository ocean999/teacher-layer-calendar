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
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  const opts = { method, headers, ...(ctrl ? { signal: ctrl.signal } : {}) };
  if (body !== null && body !== undefined) opts.body = body;
  try {
    return await fetch(url, opts);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('连接坚果云超时（15秒），请检查网络后重试');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pruneTombstones(arr = [], maxAgeMs = 60 * 86400 * 1000) {
  if (!Array.isArray(arr)) return [];
  const cutoff = Date.now() - maxAgeMs;
  return arr.filter((item) => {
    if (!item || !item.deleted) return true;
    return (item.updatedAt || 0) >= cutoff;
  });
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

function normalizeClassList(src) {
  if (src && Array.isArray(src.classTimetables) && src.classTimetables.length) {
    return src.classTimetables.map((ct, i) => ({
      id: ct.id || `cls_${i + 1}`,
      className: ct.className || ct.name || `班级${i + 1}`,
      metaUpdatedAt: ct.metaUpdatedAt || 0,
      courses: Array.isArray(ct.courses) ? ct.courses : [],
      overrides: Array.isArray(ct.overrides) ? ct.overrides : [],
      deleted: !!ct.deleted,
    }));
  }
  if (src && (Array.isArray(src.courses) || src.className)) {
    return [{
      id: src.id || 'cls_1',
      className: src.className || '902班',
      metaUpdatedAt: src.metaUpdatedAt || 0,
      courses: Array.isArray(src.courses) ? src.courses : [],
      overrides: Array.isArray(src.overrides) ? src.overrides : [],
      deleted: false,
    }];
  }
  return [];
}

function mergeClassTimetable(localInput = {}, remoteCt = null) {
  const localList = normalizeClassList(localInput);
  const remoteList = normalizeClassList(remoteCt);

  if (!remoteCt || !remoteList.length) {
    let activeList = localList.filter(c => !c.deleted).slice(0, 3);
    if (!activeList.length) {
      activeList = [{
        id: 'cls_1',
        className: localInput.className || '902班',
        metaUpdatedAt: localInput.metaUpdatedAt || 0,
        courses: Array.isArray(localInput.courses) ? localInput.courses : [],
        overrides: Array.isArray(localInput.overrides) ? localInput.overrides : [],
        deleted: false,
      }];
    }
    const activeClassId = activeList.some(c => c.id === localInput.activeClassId) ? localInput.activeClassId : activeList[0].id;
    const primary = activeList.find(c => c.id === activeClassId) || activeList[0];
    return {
      activeClassId,
      classTimetables: activeList,
      className: primary.className,
      metaUpdatedAt: primary.metaUpdatedAt || 0,
      courses: primary.courses,
      overrides: primary.overrides,
    };
  }

  const remoteIsLegacy = !Array.isArray(remoteCt.classTimetables);
  const merged = localList.map(c => ({ ...c, courses: [...c.courses], overrides: [...c.overrides] }));

  for (const rc of remoteList) {
    let idx = merged.findIndex(lc => lc.id === rc.id);
    if (idx === -1 && remoteIsLegacy && merged.length >= 1) {
      idx = merged.findIndex(lc => lc.className === rc.className);
      if (idx === -1 && merged.length === 1) idx = 0;
    }
    if (idx === -1) {
      merged.push({ ...rc, courses: [...rc.courses], overrides: [...rc.overrides] });
    } else {
      const L = merged[idx];
      const lTs = L.metaUpdatedAt || 0;
      const rTs = rc.metaUpdatedAt || 0;
      const newer = lTs >= rTs ? L : rc;
      merged[idx] = {
        id: L.id || rc.id,
        className: newer.className || L.className || rc.className || '902班',
        metaUpdatedAt: Math.max(lTs, rTs),
        deleted: !!newer.deleted,
        courses: mergeItemList(L.courses || [], rc.courses || []),
        overrides: mergeItemList(L.overrides || [], rc.overrides || []),
      };
    }
  }

  let activeList = merged.filter(c => !c.deleted).slice(0, 3);
  if (!activeList.length) {
    activeList = [{ id: 'cls_1', className: '902班', metaUpdatedAt: Date.now(), courses: [], overrides: [], deleted: false }];
  }
  const activeClassId = activeList.some(c => c.id === localInput.activeClassId)
    ? localInput.activeClassId
    : (activeList.some(c => c.id === remoteCt.activeClassId) ? remoteCt.activeClassId : activeList[0].id);
  const primary = activeList.find(c => c.id === activeClassId) || activeList[0];

  return {
    activeClassId,
    classTimetables: activeList,
    className: primary.className,
    metaUpdatedAt: primary.metaUpdatedAt,
    courses: primary.courses,
    overrides: primary.overrides,
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
  mergedTimetable.courses = pruneTombstones(mergedTimetable.courses || []);
  const mergedOverrides = pruneTombstones(mergeItemList(localData.overrides || [], (remoteOv && remoteOv.items) || []));
  const mergedWorks = pruneTombstones(mergeItemList(localData.works || [], (remoteWk && remoteWk.items) || []));
  const mergedCountdowns = pruneTombstones(mergeItemList(localData.countdowns || [], (remoteWk && remoteWk.countdowns) || []));
  const mergedClassTt = mergeClassTimetable({
    ...(localData.classTimetable || {}),
    classTimetables: localData.classTimetables,
    activeClassId: localData.activeClassId,
  }, remoteCt);
  mergedClassTt.classTimetables = (mergedClassTt.classTimetables || []).map(ct => ({
    ...ct,
    courses: pruneTombstones(ct.courses || []),
    overrides: pruneTombstones(ct.overrides || []),
  }));
  const primaryCls = mergedClassTt.classTimetables.find(c => c.id === mergedClassTt.activeClassId) || mergedClassTt.classTimetables[0];
  if (primaryCls) {
    mergedClassTt.courses = primaryCls.courses;
    mergedClassTt.overrides = primaryCls.overrides;
  }

  const now = Date.now();
  await Promise.all([
    putJsonFile(cfg, 'timetable.json', mergedTimetable),
    putJsonFile(cfg, 'overrides.json', { updatedAt: now, items: mergedOverrides }),
    putJsonFile(cfg, 'works.json', { updatedAt: now, items: mergedWorks, countdowns: mergedCountdowns }),
    putJsonFile(cfg, 'class_timetable.json', mergedClassTt),
  ]);

  return {
    timetable: mergedTimetable,
    overrides: mergedOverrides,
    works: mergedWorks,
    countdowns: mergedCountdowns,
    classTimetable: mergedClassTt,
    classTimetables: mergedClassTt.classTimetables,
    activeClassId: mergedClassTt.activeClassId,
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
  pruneTombstones,
};

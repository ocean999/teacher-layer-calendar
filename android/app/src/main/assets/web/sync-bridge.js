// 跨平台统一数据、坚果云 WebDAV 四文件同步、Excel/Word 导入与在线更新桥接器
(function () {
  const LOCAL_KEY = 'teacher_layer_calendar_state_v2';

  const DEFAULT_PERIODS = [
    { num: 1, label: '第1节', start: '08:00', end: '08:40' },
    { num: 2, label: '第2节', start: '08:55', end: '09:35' },
    { num: 3, label: '第3节', start: '09:50', end: '10:30' },
    { num: 4, label: '第4节', start: '10:40', end: '11:20' },
    { num: 5, label: '第5节', start: '13:30', end: '14:10' },
    { num: 6, label: '第6节', start: '14:25', end: '15:05' },
    { num: 7, label: '第7节', start: '15:20', end: '16:00' },
    { num: 8, label: '第8节', start: '16:10', end: '16:50' },
    { num: 9, label: '晚自习1', start: '18:30', end: '19:15' },
    { num: 10, label: '晚自习2', start: '19:25', end: '20:10' },
  ];

  function detectMode() {
    if (window.desktopApi && window.desktopApi.isDesktop) return 'desktop';
    if (window.AndroidBridge) return 'android';
    return 'web';
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
      periods: (newerMeta.periods && newerMeta.periods.length) ? newerMeta.periods : (localTt.periods || DEFAULT_PERIODS),
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

  function createFallbackState() {
    const now = Date.now();
    return {
      config: {
        webdav: {
          serverUrl: 'https://dav.jianguoyun.com/dav/',
          username: '2465179479@qq.com',
          password: '',
          folder: 'TeacherCal',
          autoSync: true,
          intervalSec: 180,
        },
        updater: { sourceUrl: '', autoCheck: true },
        ui: {
          theme: 'light',
          showCourse: true,
          showWork: true,
          homeroomMode: false,
          magnetSnap: true,
          courseOpacity: 78,
          workOpacity: 92,
          bgAlpha: 72,
          showWeekend: false,
          timeStartHour: 7.5,
          timeEndHour: 18,
          desktopPin: true,
          autoLaunch: false,
          lanEnabled: true,
          edgeSnap: true,
          fullscreenDnd: true,
          showCountdown: true,
          dedupConsecutive: true,
          frostedBlur: true,
          fontFamily: 'system',
          fontSize: 13,
          textMainColor: '',
          todayAccent: '#007aff',
          restColBg: '',
          holidayColor: '#e11d48',
          solarTermColor: '#16a34a',
          showWeekNum: true,
          restWeekdays: [6, 7],
          showStatutory: true,
          showFestival: true,
          showLunar: true,
          showSolarTerm: true,
          showYiJi: false,
          bulletStyle: 'none',
          showDoneWork: true,
          doneToBottom: true,
          autoRollover: false,
          doneSound: 'ding',
          remSound: 'chime',
          hotkeys: {
            hide: { key: 'Ctrl+Alt+H', enabled: true },
            priv: { key: 'Ctrl+Alt+F', enabled: true },
            lock: { key: 'Ctrl+Alt+L', enabled: true },
            memo: { key: 'Ctrl+Alt+N', enabled: true },
          },
        },
      },
      data: {
        timetable: { termStartDate: '2026-09-01', periods: DEFAULT_PERIODS, metaUpdatedAt: now, courses: [] },
        overrides: [],
        works: [],
        classTimetable: { className: '902班', metaUpdatedAt: now, courses: [], overrides: [] },
        activeClassId: 'cls_1',
        classTimetables: [{ id: 'cls_1', className: '902班', metaUpdatedAt: now, courses: [], overrides: [] }],
        inbox: [],
        countdowns: [],
        dayOverrides: {},
      },
      lastSyncedAt: null,
    };
  }

  function normalizeBaseUrl(url) {
    let u = (url || 'https://dav.jianguoyun.com/dav/').trim();
    if (!u.endsWith('/')) u += '/';
    return u;
  }

  function buildFolderUrl(cfg) {
    const base = normalizeBaseUrl(cfg.serverUrl);
    const folder = (cfg.folder || 'TeacherCal').trim().replace(/^\/+|\/+$/g, '');
    return folder ? `${base}${encodeURIComponent(folder)}/` : base;
  }

  function androidDavRequest(cfg, url, method, body) {
    const raw = window.AndroidBridge.webdavRequest(
      url,
      method,
      cfg.username.trim(),
      cfg.password.trim(),
      body === null || body === undefined ? '' : body
    );
    return JSON.parse(raw);
  }

  async function androidTestWebDav(cfg) {
    if (!cfg.username || !cfg.password) return { ok: false, message: '请先填写坚果云账号和第三方应用密码（同步码）' };
    const base = normalizeBaseUrl(cfg.serverUrl);
    const res = androidDavRequest(cfg, base, 'PROPFIND', '');
    if (res.status === 401 || res.status === 403) return { ok: false, message: '认证失败（401）：请确认填写的是坚果云第三方应用密码（同步码）。' };
    if (res.status >= 200 && res.status < 300) {
      androidDavRequest(cfg, buildFolderUrl(cfg), 'MKCOL', '');
      return { ok: true, message: '连接成功！已在坚果云确认同步目录。' };
    }
    return { ok: false, message: res.error || `服务器返回 HTTP ${res.status}` };
  }

  async function androidSyncAll(state) {
    const cfg = state.config.webdav;
    if (!cfg.username || !cfg.password) return { ok: false, message: '尚未填写坚果云应用密码（同步码）', state };
    try {
      const folderUrl = buildFolderUrl(cfg);
      const mk = androidDavRequest(cfg, folderUrl, 'MKCOL', '');
      if (mk.status === 401 || mk.status === 403) return { ok: false, message: '坚果云认证失败（401）', state };
      const getJson = (name) => {
        const r = androidDavRequest(cfg, folderUrl + encodeURIComponent(name), 'GET', '');
        if (r.status === 404) return null;
        if (r.status >= 200 && r.status < 300 && r.body) {
          try { return JSON.parse(r.body); } catch { return null; }
        }
        if (r.status === 401 || r.status === 403) throw new Error('坚果云认证失败（401）');
        return null;
      };
      const putJson = (name, obj) => {
        const r = androidDavRequest(cfg, folderUrl + encodeURIComponent(name), 'PUT', JSON.stringify(obj, null, 2));
        if (r.status === 401 || r.status === 403) throw new Error('坚果云认证失败（401）');
        if (!(r.status >= 200 && r.status < 300)) throw new Error(r.error || `上传 ${name} 失败（HTTP ${r.status}）`);
      };

      const remoteTt = getJson('timetable.json');
      const remoteOv = getJson('overrides.json');
      const remoteWk = getJson('works.json');
      const remoteCt = getJson('class_timetable.json');

      const mergedTimetable = mergeTimetable(state.data.timetable || {}, remoteTt);
      const mergedOverrides = mergeItemList(state.data.overrides || [], (remoteOv && remoteOv.items) || []);
      const mergedWorks = mergeItemList(state.data.works || [], (remoteWk && remoteWk.items) || []);
      const mergedCountdowns = mergeItemList(state.data.countdowns || [], (remoteWk && remoteWk.countdowns) || []);
      const mergedClassTt = mergeClassTimetable({
        ...(state.data.classTimetable || {}),
        classTimetables: state.data.classTimetables,
        activeClassId: state.data.activeClassId,
      }, remoteCt);
      const now = Date.now();

      putJson('timetable.json', mergedTimetable);
      putJson('overrides.json', { updatedAt: now, items: mergedOverrides });
      putJson('works.json', { updatedAt: now, items: mergedWorks, countdowns: mergedCountdowns });
      putJson('class_timetable.json', mergedClassTt);

      const nextState = {
        ...state,
        data: {
          timetable: mergedTimetable,
          overrides: mergedOverrides,
          works: mergedWorks,
          countdowns: mergedCountdowns,
          classTimetable: mergedClassTt,
          classTimetables: mergedClassTt.classTimetables,
          activeClassId: mergedClassTt.activeClassId,
          inbox: state.data.inbox || [],
          dayOverrides: state.data.dayOverrides || {},
        },
        lastSyncedAt: now,
      };
      window.AndroidBridge.saveState(JSON.stringify(nextState));
      return { ok: true, state: nextState, syncedAt: now };
    } catch (err) {
      return { ok: false, message: err.message, state };
    }
  }

  const mode = detectMode();
  document.body.classList.add(`mode-${mode}`);

  window.SyncBridge = {
    mode,
    DEFAULT_PERIODS,

    async loadState() {
      if (mode === 'desktop') return window.desktopApi.loadState();
      if (mode === 'android') {
        try { const raw = window.AndroidBridge.loadState(); if (raw) return JSON.parse(raw); } catch {}
        return createFallbackState();
      }
      try { const res = await fetch('/api/state'); if (res.ok) return await res.json(); } catch {}
      try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) return JSON.parse(raw); } catch {}
      return createFallbackState();
    },

    async saveState(state) {
      if (mode === 'desktop') return window.desktopApi.saveState(state);
      if (mode === 'android') { window.AndroidBridge.saveState(JSON.stringify(state)); return state; }
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
      try {
        const res = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
        if (res.ok) { const j = await res.json(); if (j.state) return j.state; }
      } catch {}
      return state;
    },

    async syncWebDav(state) {
      if (mode === 'desktop') return window.desktopApi.syncWebDav({ data: state.data });
      if (mode === 'android') return androidSyncAll(state);
      try {
        const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: state.data }) });
        return await res.json();
      } catch (err) {
        return { ok: false, message: `局域网同步失败：${err.message}`, state };
      }
    },

    async testWebDav(cfg) {
      if (mode === 'desktop') return window.desktopApi.testWebDav(cfg);
      if (mode === 'android') return androidTestWebDav(cfg);
      try {
        const res = await fetch('/api/webdav/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        return await res.json();
      } catch (err) { return { ok: false, message: `测试连接失败：${err.message}` }; }
    },

    async importSchedule(opts = { target: 'my', kind: 'auto' }) {
      if (mode === 'desktop') return window.desktopApi.importSchedule(opts);
      return { canceled: false, ok: false, message: 'Excel / Word / 拍照 OCR 智能识别请在 Windows 电脑端使用，识别后会自动通过坚果云同步到手机！' };
    },

    async exportExcelTemplate() {
      if (mode === 'desktop') return window.desktopApi.exportExcelTemplate();
      return { canceled: false, ok: false, message: '模板导出请在 Windows 电脑端操作。' };
    },

    async getAppVersion() {
      if (mode === 'desktop') return window.desktopApi.getAppVersion();
      return '1.6.0';
    },

    async checkUpdate(cfg) {
      if (mode === 'desktop') return window.desktopApi.checkUpdate(cfg);
      return { ok: true, hasUpdate: false, currentVersion: '1.6.0', latestVersion: '1.6.0', message: '在线一键热更新支持在 Windows 桌面端运行；安卓端可在 GitHub Actions 自动生成最新 APK。' };
    },

    async applyUpdate(downloadUrl) {
      if (mode === 'desktop') return window.desktopApi.applyUpdate(downloadUrl);
      return { ok: false, message: '仅 Windows 桌面端支持一键热更新。' };
    },

    async isFullscreenBusy() {
      if (mode === 'desktop' && window.desktopApi && typeof window.desktopApi.isFullscreenBusy === 'function') {
        try { return !!(await window.desktopApi.isFullscreenBusy()); } catch { return false; }
      }
      return !!document.fullscreenElement;
    },

    async getLanInfo() {
      if (mode === 'desktop') return window.desktopApi.getLanInfo();
      return { running: false, urls: [] };
    },

    async setDesktopOptions(opts) {
      if (mode === 'desktop') return window.desktopApi.setDesktopOptions(opts);
      return null;
    },

    async windowAction(act) {
      if (mode === 'desktop') return window.desktopApi.windowAction(act);
    },

    notifyWidgetSummary(summaryJson) {
      if (mode === 'android' && window.AndroidBridge && window.AndroidBridge.updateWidgetData) {
        try { window.AndroidBridge.updateWidgetData(summaryJson); } catch {}
      }
    },
  };
})();

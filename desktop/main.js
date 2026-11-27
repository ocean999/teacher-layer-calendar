const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const webdav = require('./webdav');
const excelImport = require('./excel-import');
const updater = require('./updater');
const { createLanServer } = require('./lan-server');

const APP_ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(APP_ROOT, 'shared', 'web');
const PKG = require(path.join(APP_ROOT, 'package.json'));

let mainWindow = null;
let tray = null;
let lanServer = null;
let isLocked = false;
let winZProc = null;
let winZReady = false;
let pendingWinZLines = [];
let winZOtherFullscreen = false;
let reassertBottomTimer = null;
let reassertFollowTimer = null;
let rendererCrashTimes = [];
let gpuCrashCount = 0;

function writeCrashLog(tag, err) {
  try {
    const line = `[${new Date().toISOString()}] [${tag}] ${err && err.stack ? err.stack : err}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), line, 'utf8');
  } catch {}
}
process.on('uncaughtException', (err) => writeCrashLog('uncaughtException', err));
process.on('unhandledRejection', (err) => writeCrashLog('unhandledRejection', err));

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getDataFilePath() {
  return path.join(app.getPath('userData'), 'teacher-cal-state.json');
}

function buildDefaultClassCourses(now) {
  const P = excelImport.DEFAULT_PERIODS;
  const grid = [
    // [weekday, periodIndex(0-based), title]
    [1,0,'历史（张）'],[1,1,'语文（林）'],[1,2,'科学（王）'],[1,3,'数学（陈）'],[1,4,'英语（周）'],[1,5,'美术（孙）'],[1,6,'自习'],
    [2,0,'数学（陈）'],[2,1,'英语（周）'],[2,2,'语文（林）'],[2,3,'道法（张）'],[2,4,'体育（赵）'],[2,5,'科学（王）'],[2,6,'心理'],
    [3,0,'语文（林）'],[3,1,'数学（陈）'],[3,2,'英语（周）'],[3,3,'科学（王）'],[3,4,'地理（张）'],[3,5,'体育（赵）'],[3,6,'902班会（张）'],
    [4,0,'英语（周）'],[4,1,'科学（王）'],[4,2,'数学（陈）'],[4,3,'历史（张）'],[4,4,'语文（林）'],[4,5,'音乐（钱）'],[4,6,'自习'],
    [5,0,'数学（陈）'],[5,1,'语文（林）'],[5,2,'道法（张）'],[5,3,'英语（周）'],[5,4,'科学（王）'],[5,5,'信息（吴）'],[5,6,'社团'],
    [1,8,'语文晚练'],[2,8,'数学晚练'],[3,8,'社政晚自习（张）'],[4,8,'英语晚练'],[5,8,'社政晚自习（张）'],
    [1,9,'自主作业'],[2,9,'自主作业'],[3,9,'902晚自习（张）'],[4,9,'自主作业'],[5,9,'周清整理（张）'],
  ];
  return grid.map(([wd, pi, title], idx) => ({
    id: `cc_demo_${idx + 1}`,
    weekday: wd,
    start: P[pi].start,
    end: P[pi].end,
    title,
    room: '902班',
    parity: 'all',
    color: excelImport.guessColor(title),
    updatedAt: now,
    deleted: false,
  }));
}

function createDefaultState() {
  const now = Date.now();
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const mon = new Date(today);
  mon.setDate(today.getDate() - mondayOffset);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return fmt(x); };
  const P = excelImport.DEFAULT_PERIODS;

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
      updater: {
        sourceUrl: 'ocean999/teacher-layer-calendar',
        autoCheck: true,
      },
      ui: {
        theme: 'auto', // 3档：light(白天) / dark(黑夜) / auto(自动识别)
        skinColor: '',
        skinColorName: '默认',
        showCourse: true,
        showWork: true,
        homeroomMode: false, // 互斥模式：勾选时隐藏底层课表和顶层干活，仅呈现班主任班级全周课表
        magnetSnap: true, // 拖拽调课自动略过课间磁吸到节次
        courseOpacity: 78,
        workOpacity: 92,
        bgAlpha: 72,
        showEvening: false, // 是否展示晚自习
        showWeekend: false, // 是否展示周末
        locked: false, // 锁定固定防误触模式
        timeStartHour: 7.5,
        timeEndHour: 17.5,
        desktopPin: true,
        autoLaunch: false,
        reminderEnabled: true,
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
      bounds: null,
    },
    data: {
      timetable: {
        termStartDate: '2026-09-01',
        periods: P,
        metaUpdatedAt: now,
        courses: [
          { id: 'c_demo_1', weekday: 1, start: P[0].start, end: P[0].end, title: '902 历史', room: '', parity: 'all', color: 'sky', updatedAt: now, deleted: false },
          { id: 'c_demo_2', weekday: 1, start: P[2].start, end: P[2].end, title: '901 道法', room: '', parity: 'all', color: 'emerald', updatedAt: now, deleted: false },
          { id: 'c_demo_3', weekday: 1, start: P[5].start, end: P[5].end, title: '904 地理', room: '', parity: 'all', color: 'violet', updatedAt: now, deleted: false },
          { id: 'c_demo_4', weekday: 2, start: P[1].start, end: P[1].end, title: '903 历史', room: '', parity: 'all', color: 'sky', updatedAt: now, deleted: false },
          { id: 'c_demo_5', weekday: 2, start: P[3].start, end: P[3].end, title: '902 道法', room: '', parity: 'all', color: 'emerald', updatedAt: now, deleted: false },
          { id: 'c_demo_6', weekday: 2, start: P[4].start, end: P[4].end, title: '901 历史', room: '', parity: 'all', color: 'sky', updatedAt: now, deleted: false },
          { id: 'c_demo_7', weekday: 3, start: P[0].start, end: P[0].end, title: '901 历史', room: '', parity: 'all', color: 'sky', updatedAt: now, deleted: false },
          { id: 'c_demo_8', weekday: 3, start: P[4].start, end: P[4].end, title: '902 地理', room: '', parity: 'all', color: 'violet', updatedAt: now, deleted: false },
          { id: 'c_demo_9', weekday: 3, start: P[6].start, end: P[6].end, title: '902 班会', room: '', parity: 'all', color: 'indigo', updatedAt: now, deleted: false },
          { id: 'c_demo_10', weekday: 4, start: P[1].start, end: P[1].end, title: '904 道法', room: '', parity: 'all', color: 'emerald', updatedAt: now, deleted: false },
          { id: 'c_demo_11', weekday: 4, start: P[3].start, end: P[3].end, title: '902 历史', room: '', parity: 'all', color: 'sky', updatedAt: now, deleted: false },
          { id: 'c_demo_12', weekday: 4, start: P[5].start, end: P[5].end, title: '903 地理', room: '', parity: 'all', color: 'violet', updatedAt: now, deleted: false },
          { id: 'c_demo_13', weekday: 5, start: P[0].start, end: P[0].end, title: '903 地理', room: '', parity: 'all', color: 'violet', updatedAt: now, deleted: false },
          { id: 'c_demo_14', weekday: 5, start: P[2].start, end: P[2].end, title: '902 道法', room: '', parity: 'all', color: 'emerald', updatedAt: now, deleted: false },
          { id: 'c_demo_15', weekday: 3, start: P[8].start, end: P[8].end, title: '902 晚自习值班', room: '', parity: 'all', color: 'indigo', updatedAt: now, deleted: false },
          { id: 'c_demo_16', weekday: 5, start: P[8].start, end: P[8].end, title: '902 晚自习值班', room: '', parity: 'all', color: 'indigo', updatedAt: now, deleted: false },
        ],
      },
      overrides: [],
      works: [
        { id: 'w_demo_1', date: addDays(mon, 0), start: '08:50', end: '09:40', title: '批改 902 作业本', note: '空堂干活', urgent: false, done: false, updatedAt: now, deleted: false },
        { id: 'w_demo_2', date: addDays(mon, 0), start: '15:20', end: '16:30', title: '社政备课组例会', note: '带进度表', urgent: true, done: false, updatedAt: now, deleted: false },
        { id: 'w_demo_3', date: addDays(mon, 1), start: '10:30', end: '11:25', title: '年级临时会（试试磁吸拖走902道法）', note: '', urgent: true, done: false, updatedAt: now, deleted: false },
        { id: 'w_demo_4', date: addDays(mon, 3), start: '13:30', end: '14:15', title: '联系家长沟通近况', note: '', urgent: false, done: false, updatedAt: now, deleted: false },
      ],
      classTimetable: {
        className: '902班',
        metaUpdatedAt: now,
        courses: buildDefaultClassCourses(now),
        overrides: [],
      },
      activeClassId: 'cls_1',
      classTimetables: [
        {
          id: 'cls_1',
          className: '902班',
          metaUpdatedAt: now,
          courses: buildDefaultClassCourses(now),
          overrides: [],
        },
      ],
      inbox: [],
      countdowns: [],
      dayOverrides: {},
    },
    lastSyncedAt: null,
  };
}

function normalizeLoadedClassData(parsedData, defData) {
  let list = [];
  if (Array.isArray(parsedData?.classTimetables) && parsedData.classTimetables.length) {
    list = parsedData.classTimetables.map((ct, i) => ({
      id: ct.id || `cls_${i + 1}`,
      className: ct.className || ct.name || `班级${i + 1}`,
      metaUpdatedAt: ct.metaUpdatedAt || 0,
      courses: Array.isArray(ct.courses) ? ct.courses : [],
      overrides: Array.isArray(ct.overrides) ? ct.overrides : [],
    })).slice(0, 3);
  } else if (parsedData?.classTimetable && Array.isArray(parsedData.classTimetable.courses)) {
    const ct = parsedData.classTimetable;
    list = [{
      id: ct.id || 'cls_1',
      className: ct.className || '902班',
      metaUpdatedAt: ct.metaUpdatedAt || 0,
      courses: ct.courses,
      overrides: Array.isArray(ct.overrides) ? ct.overrides : [],
    }];
  } else {
    list = defData.classTimetables;
  }
  const activeClassId = list.some(c => c.id === parsedData?.activeClassId) ? parsedData.activeClassId : list[0].id;
  const primary = list.find(c => c.id === activeClassId) || list[0];
  return {
    activeClassId,
    classTimetables: list,
    classTimetable: {
      className: primary.className,
      metaUpdatedAt: primary.metaUpdatedAt,
      courses: primary.courses,
      overrides: primary.overrides,
    },
  };
}

function parseAndNormalizeState(rawText) {
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid state root');
  const def = createDefaultState();
  const clsData = normalizeLoadedClassData(parsed.data, def.data);
  const rawUi = parsed.config?.ui || {};
  const mergedHotkeys = {
    hide: { ...def.config.ui.hotkeys.hide, ...(rawUi.hotkeys?.hide || {}) },
    priv: { ...def.config.ui.hotkeys.priv, ...(rawUi.hotkeys?.priv || {}) },
    lock: { ...def.config.ui.hotkeys.lock, ...(rawUi.hotkeys?.lock || {}) },
    memo: { ...def.config.ui.hotkeys.memo, ...(rawUi.hotkeys?.memo || {}) },
  };
  return {
    config: {
      webdav: { ...def.config.webdav, ...(parsed.config?.webdav || {}) },
      updater: { ...def.config.updater, ...(parsed.config?.updater || {}) },
      ui: {
        ...def.config.ui,
        ...rawUi,
        restWeekdays: Array.isArray(rawUi.restWeekdays) ? rawUi.restWeekdays : def.config.ui.restWeekdays,
        hotkeys: mergedHotkeys,
      },
      bounds: parsed.config?.bounds || null,
    },
    data: {
      timetable: {
        ...def.data.timetable,
        ...(parsed.data?.timetable || {}),
        periods: (parsed.data?.timetable?.periods && parsed.data.timetable.periods.length)
          ? parsed.data.timetable.periods
          : def.data.timetable.periods,
      },
      overrides: Array.isArray(parsed.data?.overrides) ? parsed.data.overrides : [],
      works: Array.isArray(parsed.data?.works) ? parsed.data.works : [],
      classTimetable: clsData.classTimetable,
      activeClassId: clsData.activeClassId,
      classTimetables: clsData.classTimetables,
      inbox: Array.isArray(parsed.data?.inbox) ? parsed.data.inbox : [],
      countdowns: Array.isArray(parsed.data?.countdowns) ? parsed.data.countdowns : [],
      dayOverrides: (parsed.data?.dayOverrides && typeof parsed.data.dayOverrides === 'object')
        ? parsed.data.dayOverrides
        : {},
    },
    lastSyncedAt: parsed.lastSyncedAt || null,
  };
}

function compactStateTombstones(st) {
  if (!st || !st.data) return st;
  const prune = webdav.pruneTombstones;
  if (typeof prune !== 'function') return st;
  if (st.data.timetable && Array.isArray(st.data.timetable.courses)) {
    st.data.timetable.courses = prune(st.data.timetable.courses);
  }
  if (Array.isArray(st.data.overrides)) st.data.overrides = prune(st.data.overrides);
  if (Array.isArray(st.data.works)) st.data.works = prune(st.data.works);
  if (Array.isArray(st.data.countdowns)) st.data.countdowns = prune(st.data.countdowns);
  if (Array.isArray(st.data.classTimetables)) {
    st.data.classTimetables = st.data.classTimetables.map((ct) => ({
      ...ct,
      courses: prune(ct.courses || []),
      overrides: prune(ct.overrides || []),
    }));
    const primary = st.data.classTimetables.find(c => c.id === st.data.activeClassId) || st.data.classTimetables[0];
    if (primary) {
      st.data.classTimetable = {
        id: primary.id,
        className: primary.className,
        metaUpdatedAt: primary.metaUpdatedAt || 0,
        courses: primary.courses,
        overrides: primary.overrides,
      };
    }
  }
  return st;
}

function loadState() {
  const file = getDataFilePath();
  const bakFile = `${file}.bak`;
  if (!fs.existsSync(file)) {
    if (fs.existsSync(bakFile)) {
      try {
        const recovered = parseAndNormalizeState(fs.readFileSync(bakFile, 'utf8'));
        saveState(recovered);
        return recovered;
      } catch (bakErr) {
        writeCrashLog('loadState-bak-recovery-failed', bakErr);
      }
    }
    const def = createDefaultState();
    saveState(def);
    return def;
  }
  try {
    return parseAndNormalizeState(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    writeCrashLog('loadState-corrupt', err);
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {}
    if (fs.existsSync(bakFile)) {
      try {
        const recovered = parseAndNormalizeState(fs.readFileSync(bakFile, 'utf8'));
        saveState(recovered);
        return recovered;
      } catch (bakErr) {
        writeCrashLog('loadState-bak-recovery-failed', bakErr);
      }
    }
    const def = createDefaultState();
    saveState(def);
    return def;
  }
}

function saveState(nextState) {
  const file = getDataFilePath();
  const bakFile = `${file}.bak`;
  const tmpFile = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  compactStateTombstones(nextState);
  const serialized = JSON.stringify(nextState, null, 2);
  fs.writeFileSync(tmpFile, serialized, 'utf8');
  try {
    if (fs.existsSync(file)) {
      const prevStat = fs.statSync(file);
      if (prevStat.size > 2) fs.copyFileSync(file, bakFile);
    }
  } catch {}
  try {
    fs.renameSync(tmpFile, file);
  } catch {
    fs.copyFileSync(tmpFile, file);
    try { fs.unlinkSync(tmpFile); } catch {}
  }
  return nextState;
}

function mergeStatePayload(cur, payload = {}) {
  const incomingWd = payload.config?.webdav;
  const mergedWebdav = incomingWd
    ? {
        ...cur.config.webdav,
        ...incomingWd,
        password: incomingWd.password === '__SAVED__' ? (cur.config.webdav?.password || '') : incomingWd.password,
      }
    : cur.config.webdav;
  const nextConfig = payload.config
    ? {
        ...cur.config,
        ...payload.config,
        webdav: mergedWebdav,
        ui: payload.config.ui ? { ...cur.config.ui, ...payload.config.ui } : cur.config.ui,
      }
    : cur.config;
  return {
    ...cur,
    config: nextConfig,
    data: payload.data ? payload.data : cur.data,
    lastSyncedAt: payload.lastSyncedAt !== undefined ? payload.lastSyncedAt : cur.lastSyncedAt,
  };
}

function syncLanServerWithUi(ui) {
  if (!lanServer) return;
  if (ui && ui.lanEnabled === false) lanServer.stop();
  else lanServer.start();
}

function buildTrayIcon() {
  const w = 32, h = 32;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < w; x++) {
      const idx = rowStart + 1 + x * 4;
      const inBox = x >= 3 && x <= 28 && y >= 4 && y <= 28;
      const isHeader = inBox && y <= 11;
      const isLayer1 = inBox && y >= 14 && y <= 20 && x >= 6 && x <= 19;
      const isLayer2 = inBox && y >= 18 && y <= 25 && x >= 12 && x <= 25;
      if (isLayer2) {
        raw[idx] = 255; raw[idx + 1] = 149; raw[idx + 2] = 0; raw[idx + 3] = 255;
      } else if (isLayer1) {
        raw[idx] = 0; raw[idx + 1] = 122; raw[idx + 2] = 255; raw[idx + 3] = 255;
      } else if (isHeader) {
        raw[idx] = 255; raw[idx + 1] = 59; raw[idx + 2] = 48; raw[idx + 3] = 255;
      } else if (inBox) {
        raw[idx] = 248; raw[idx + 1] = 250; raw[idx + 2] = 252; raw[idx + 3] = 245;
      }
    }
  }
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function ensureWinZHelper() {
  if (process.platform !== 'win32') return null;
  if (winZProc && !winZProc.killed) return winZProc;
  winZReady = false;
  const csCode = [
    'using System;',
    'using System.Text;',
    'using System.Threading;',
    'using System.Runtime.InteropServices;',
    'public static class WinZ {',
    '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }',
    '  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);',
    '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);',
    '  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);',
    '  [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);',
    '  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr FindWindow(string cls, string win);',
    '  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string win);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);',
    '  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);',
    '  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);',
    '  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int pvAttr, int cbAttr);',
    '  public static volatile IntPtr LockedHwnd = IntPtr.Zero;',
    '  public static volatile IntPtr SelfHwnd = IntPtr.Zero;',
    '  private static bool tempTopmost = false;',
    '  private static int lastFs = -1;',
    '  public static void SetExTool(IntPtr h, bool tool) {',
    '    int ex = GetWindowLong(h, -20);',
    '    if (tool) ex = (ex | 0x00000080) & ~0x00040000;',
    '    else ex = (ex & ~0x00000080) | 0x00040000;',
    '    SetWindowLong(h, -20, ex);',
    '    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0037);',
    '  }',
    '  public static IntPtr FindDesktopHost() {',
    '    IntPtr prog = FindWindow("Progman", null);',
    '    if (prog != IntPtr.Zero && FindWindowEx(prog, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) return prog;',
    '    IntPtr found = IntPtr.Zero;',
    '    EnumWindows(delegate(IntPtr h, IntPtr l) {',
    '      if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { found = h; return false; }',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return found != IntPtr.Zero ? found : prog;',
    '  }',
    '  private static string Cls(IntPtr h) {',
    '    StringBuilder sb = new StringBuilder(64);',
    '    GetClassName(h, sb, 64);',
    '    return sb.ToString();',
    '  }',
    '  private static bool IsCloaked(IntPtr h) {',
    '    int c = 0;',
    '    try { if (DwmGetWindowAttribute(h, 14, out c, 4) == 0 && c != 0) return true; } catch {}',
    '    return false;',
    '  }',
    '  public static bool IsWindowBelow(IntPtr a, IntPtr b) {',
    '    IntPtr cur = GetWindow(a, 3);',
    '    int guard = 0;',
    '    while (cur != IntPtr.Zero && guard++ < 512) {',
    '      if (cur == b) return true;',
    '      cur = GetWindow(cur, 3);',
    '    }',
    '    return false;',
    '  }',
    '  public static bool HasNormalWindowBelow(IntPtr h, IntPtr desktopHost) {',
    '    IntPtr cur = GetWindow(h, 2);',
    '    int guard = 0;',
    '    while (cur != IntPtr.Zero && guard++ < 400) {',
    '      if (cur == desktopHost) break;',
    '      if (IsWindowVisible(cur) && !IsIconic(cur) && !IsCloaked(cur)) {',
    '        int ex = GetWindowLong(cur, -20);',
    '        if ((ex & 0x00000080) == 0 && (ex & 0x00000008) == 0) {',
    '          string cn = Cls(cur);',
    '          if (cn != "Progman" && cn != "WorkerW" && cn != "Shell_TrayWnd" && cn != "Shell_SecondaryTrayWnd") {',
    '            RECT r; if (GetWindowRect(cur, out r) && (r.Right - r.Left) > 80 && (r.Bottom - r.Top) > 80) return true;',
    '          }',
    '        }',
    '      }',
    '      cur = GetWindow(cur, 2);',
    '    }',
    '    return false;',
    '  }',
    '  public static void SinkBottom(IntPtr h, IntPtr desktopHost) {',
    '    if (desktopHost != IntPtr.Zero) {',
    '      IntPtr prev = GetWindow(desktopHost, 3);',
    '      if (prev != IntPtr.Zero && prev != h) {',
    '        SetWindowPos(h, prev, 0, 0, 0, 0, 0x0413);',
    '        return;',
    '      }',
    '    }',
    '    SetWindowPos(h, (IntPtr)1, 0, 0, 0, 0, 0x0413);',
    '  }',
    '  public static void ApplyLock(IntPtr h) {',
    '    SelfHwnd = h;',
    '    LockedHwnd = h;',
    '    if (h == IntPtr.Zero || !IsWindow(h)) return;',
    '    SetExTool(h, true);',
    '    IntPtr host = FindDesktopHost();',
    '    if (host != IntPtr.Zero) try { SetWindowLongPtr(h, -8, host); } catch {}',
    '    SinkBottom(h, host);',
    '  }',
    '  public static void ApplyUnlock(IntPtr h, bool clearTool) {',
    '    LockedHwnd = IntPtr.Zero;',
    '    if (tempTopmost && h != IntPtr.Zero && IsWindow(h)) {',
    '      SetWindowPos(h, (IntPtr)(-2), 0, 0, 0, 0, 0x0413);',
    '      tempTopmost = false;',
    '    }',
    '    if (h == IntPtr.Zero || !IsWindow(h)) return;',
    '    try { SetWindowLongPtr(h, -8, IntPtr.Zero); } catch {}',
    '    if (clearTool) SetExTool(h, false);',
    '    SetWindowPos(h, (IntPtr)(-2), 0, 0, 0, 0, 0x0003);',
    '    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0043);',
    '    BringWindowToTop(h);',
    '    SetForegroundWindow(h);',
    '  }',
    '  public static int CheckOtherFullscreen() {',
    '    IntPtr fg = GetForegroundWindow();',
    '    if (fg == IntPtr.Zero || fg == SelfHwnd || !IsWindowVisible(fg) || IsIconic(fg) || IsCloaked(fg)) return 0;',
    '    string cn = Cls(fg);',
    '    if (cn == "Progman" || cn == "WorkerW" || cn == "Shell_TrayWnd" || cn == "Shell_SecondaryTrayWnd" || cn == "Windows.UI.Core.CoreWindow") return 0;',
    '    RECT wr; if (!GetWindowRect(fg, out wr)) return 0;',
    '    IntPtr mon = MonitorFromWindow(fg, 2);',
    '    if (mon == IntPtr.Zero) return 0;',
    '    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));',
    '    if (!GetMonitorInfo(mon, ref mi)) return 0;',
    '    int mw = mi.rcMonitor.Right - mi.rcMonitor.Left;',
    '    int mh = mi.rcMonitor.Bottom - mi.rcMonitor.Top;',
    '    if (mw <= 0 || mh <= 0) return 0;',
    '    int ww = wr.Right - wr.Left, wh = wr.Bottom - wr.Top;',
    '    return (ww >= mw * 0.98 && wh >= mh * 0.98) ? 1 : 0;',
    '  }',
    '  public static void StartWatcher() {',
    '    Thread t = new Thread(delegate() {',
    '      int tick = 0;',
    '      while (true) {',
    '        try {',
    '          IntPtr h = LockedHwnd;',
    '          if (h != IntPtr.Zero && IsWindow(h)) {',
    '            if (IsIconic(h)) ShowWindow(h, 4);',
    '            IntPtr host = FindDesktopHost();',
    '            bool desktopTopmost = host != IntPtr.Zero && ((GetWindowLong(host, -20) & 0x0008) != 0);',
    '            if (desktopTopmost) {',
    '              SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x0413);',
    '              tempTopmost = true;',
    '            } else {',
    '              if (tempTopmost) {',
    '                SetWindowPos(h, (IntPtr)(-2), 0, 0, 0, 0, 0x0413);',
    '                tempTopmost = false;',
    '                SinkBottom(h, host);',
    '              } else if (host != IntPtr.Zero && IsWindowBelow(h, host)) {',
    '                IntPtr prev = GetWindow(host, 3);',
    '                SetWindowPos(h, prev != IntPtr.Zero ? prev : IntPtr.Zero, 0, 0, 0, 0, 0x0413);',
    '              } else if (HasNormalWindowBelow(h, host)) {',
    '                SinkBottom(h, host);',
    '              }',
    '            }',
    '          }',
    '          if ((tick++ % 10) == 0) {',
    '            int fs = CheckOtherFullscreen();',
    '            if (fs != lastFs) {',
    '              lastFs = fs;',
    '              Console.Out.WriteLine("FS:" + fs);',
    '              Console.Out.Flush();',
    '            }',
    '          }',
    '        } catch {}',
    '        Thread.Sleep(110);',
    '      }',
    '    });',
    '    t.IsBackground = true;',
    '    t.Start();',
    '  }',
    '}',
  ].join('\n');
  const csB64 = Buffer.from(csCode, 'utf8').toString('base64');
  const psScript = [
    `$cs = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${csB64}'))`,
    'Add-Type -TypeDefinition $cs -Language CSharp',
    '[WinZ]::StartWatcher()',
    '[Console]::Out.WriteLine("READY")',
    '[Console]::Out.Flush()',
    'while (($line = [Console]::In.ReadLine()) -ne $null) {',
    '  $parts = $line.Trim().Split(" ")',
    '  if ($parts.Length -lt 2) { continue }',
    '  $cmd = $parts[0]; $h = [IntPtr]([Int64]$parts[1])',
    '  if ($cmd -eq "SELF") {',
    '    [WinZ]::SelfHwnd = $h',
    '  } elseif ($cmd -eq "LOCK" -or $cmd -eq "BOTTOM") {',
    '    [WinZ]::ApplyLock($h)',
    '  } elseif ($cmd -eq "UNLOCK" -or $cmd -eq "NORMAL") {',
    '    $clearTool = ($parts.Length -ge 3 -and $parts[2] -eq "1")',
    '    [WinZ]::ApplyUnlock($h, $clearTool)',
    '  }',
    '}',
  ].join('\n');
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  winZProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let stdoutBuf = '';
  winZProc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === 'READY' && !winZReady) {
        winZReady = true;
        while (pendingWinZLines.length && winZProc && winZProc.stdin && !winZProc.stdin.destroyed) {
          const cmdLine = pendingWinZLines.shift();
          try { winZProc.stdin.write(cmdLine); } catch {}
        }
      } else if (line === 'FS:1') {
        winZOtherFullscreen = true;
      } else if (line === 'FS:0') {
        winZOtherFullscreen = false;
      }
    }
  });
  const reset = () => { winZProc = null; winZReady = false; winZOtherFullscreen = false; };
  winZProc.on('exit', reset);
  winZProc.on('error', reset);
  return winZProc;
}

function getMainHwndDecimal() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const buf = mainWindow.getNativeWindowHandle();
    if (!buf || !buf.length) return null;
    return buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
  } catch {
    return null;
  }
}

function sendWinZCommand(cmd, hwndStr) {
  if (process.platform !== 'win32' || !hwndStr) return;
  const p = ensureWinZHelper();
  if (!p) return;
  const line = `${cmd} ${hwndStr}\n`;
  if (!winZReady || !p.stdin || p.stdin.destroyed) {
    pendingWinZLines.push(line);
    if (pendingWinZLines.length > 8) pendingWinZLines.shift();
    return;
  }
  try { p.stdin.write(line); } catch {}
}

function applyWindowBottomPin(locked) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const hwnd = getMainHwndDecimal();
  if (locked) {
    try { mainWindow.setAlwaysOnTop(false); } catch {}
    sendWinZCommand('LOCK', hwnd);
  } else {
    clearTimeout(reassertBottomTimer);
    clearTimeout(reassertFollowTimer);
    const cur = loadState();
    const clearTool = cur.config.ui.desktopPin === false ? '1' : '0';
    sendWinZCommand('UNLOCK', `${hwnd} ${clearTool}`);
    try { mainWindow.focus(); } catch {}
  }
}

function scheduleReassertBottom(delayMs = 45) {
  clearTimeout(reassertBottomTimer);
  clearTimeout(reassertFollowTimer);
  reassertBottomTimer = setTimeout(() => {
    if (isLocked && mainWindow && !mainWindow.isDestroyed()) {
      applyWindowBottomPin(true);
    }
  }, delayMs);
  reassertFollowTimer = setTimeout(() => {
    if (isLocked && mainWindow && !mainWindow.isDestroyed()) {
      applyWindowBottomPin(true);
    }
  }, Math.max(delayMs + 95, 140));
}

function setDesktopLock(locked) {
  isLocked = !!locked;
  const cur = loadState();
  cur.config.ui.locked = isLocked;
  saveState(cur);
  if (mainWindow && !mainWindow.isDestroyed()) {
    // 锁定后固定窗口位置与长宽高、禁用最小化，并自动下沉固定在桌面最底层且免疫 Win+D；解锁才恢复正常窗口层级
    try { mainWindow.setMinimizable(!isLocked); } catch {}
    mainWindow.setMovable(!isLocked);
    mainWindow.setResizable(!isLocked);
    mainWindow.setSkipTaskbar(isLocked ? true : !!cur.config.ui.desktopPin);
    applyWindowBottomPin(isLocked);
    mainWindow.webContents.send('win:lock-changed', isLocked);
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const st = loadState();
  const lanInfo = lanServer ? lanServer.getInfo() : { urls: [] };
  const lanLabel = lanInfo.urls.length ? `手机局域网地址：${lanInfo.urls[0]}` : '局域网服务未开启';
  const menu = Menu.buildFromTemplate([
    {
      label: `显示 / 聚焦桌面日历 (v${PKG.version})`,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          if (isLocked) scheduleReassertBottom(30);
          else mainWindow.focus();
        }
      },
    },
    {
      label: isLocked ? '🔓 解锁并恢复正常窗口层级' : '🔒 锁定并下沉固定在桌面最底层',
      click: () => setDesktopLock(!isLocked),
    },
    { type: 'separator' },
    {
      label: '☁ 立即同步坚果云',
      click: async () => {
        const res = await runSync();
        if (res.ok && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('state:external-update', res.state);
        }
      },
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: !!st.config.ui.autoLaunch,
      click: (item) => {
        const cur = loadState();
        cur.config.ui.autoLaunch = item.checked;
        saveState(cur);
        app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('state:external-update', cur);
        }
      },
    },
    { type: 'separator' },
    { label: lanLabel, enabled: false },
    { label: `快捷键 ${st.config.ui?.hotkeys?.lock?.key || 'Ctrl+Alt+L'} 随时锁定/解锁`, enabled: false },
    { type: 'separator' },
    { label: '⏻ 彻底退出桌面日历', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function toElectronAccelerator(combo) {
  if (!combo || typeof combo !== 'string') return '';
  return combo
    .split('+')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      if (/^ctrl$/i.test(p)) return 'CommandOrControl';
      if (/^meta|cmd|super$/i.test(p)) return 'Super';
      if (p.length === 1) return p.toUpperCase();
      return p;
    })
    .join('+');
}

function applyGlobalShortcuts(ui) {
  if (!app.isReady()) return;
  try {
    globalShortcut.unregisterAll();
  } catch {}
  const defHotkeys = createDefaultState().config.ui.hotkeys;
  const hk = ui?.hotkeys || defHotkeys;
  const register = (cfg, handler) => {
    if (!cfg || !cfg.enabled || !cfg.key) return;
    const acc = toElectronAccelerator(cfg.key);
    if (!acc) return;
    try {
      globalShortcut.register(acc, handler);
    } catch {}
  };

  register(hk.hide || defHotkeys.hide, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  register(hk.lock || defHotkeys.lock, () => setDesktopLock(!isLocked));
  register(hk.priv || defHotkeys.priv, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:hotkey-action', 'priv');
    }
  });
  register(hk.memo || defHotkeys.memo, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
    }
    mainWindow.focus();
    mainWindow.webContents.send('win:hotkey-action', 'memo');
  });
}

async function runSync(overrideData = null) {
  const st = loadState();
  if (overrideData) {
    st.data = overrideData;
    saveState(st);
  }
  const cfg = st.config.webdav;
  if (!cfg.username || !cfg.password) {
    return { ok: false, message: '尚未填写坚果云应用密码（同步码）', state: st };
  }
  try {
    const merged = await webdav.syncAll(cfg, st.data);
    st.data = {
      timetable: merged.timetable,
      overrides: merged.overrides,
      works: merged.works,
      classTimetable: merged.classTimetable,
      classTimetables: merged.classTimetables,
      activeClassId: merged.activeClassId,
      inbox: st.data.inbox || [],
      countdowns: merged.countdowns || st.data.countdowns || [],
      dayOverrides: st.data.dayOverrides || {},
    };
    st.lastSyncedAt = merged.syncedAt;
    saveState(st);
    return { ok: true, state: st, syncedAt: merged.syncedAt };
  } catch (err) {
    return { ok: false, message: err.message, state: st };
  }
}

function ensureVisibleBounds(b) {
  const primary = screen.getPrimaryDisplay().workArea;
  const fallbackW = Math.min(1160, Math.round(primary.width * 0.74));
  const fallbackH = Math.min(740, Math.round(primary.height * 0.84));
  const defBounds = {
    width: Math.max(680, fallbackW),
    height: Math.max(520, fallbackH),
    x: primary.x + Math.round((primary.width - Math.max(680, fallbackW)) / 2),
    y: primary.y + Math.round((primary.height - Math.max(520, fallbackH)) / 2),
  };
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.width !== 'number' || typeof b.height !== 'number') {
    return defBounds;
  }
  const displays = screen.getAllDisplays();
  const hasVisibleIntersection = displays.some((disp) => {
    const wa = disp.workArea;
    const ix = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const iy = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return ix >= 120 && iy >= 80;
  });
  if (hasVisibleIntersection) return b;
  const w = Math.max(680, Math.min(b.width, primary.width));
  const h = Math.max(520, Math.min(b.height, primary.height));
  return {
    width: w,
    height: h,
    x: primary.x + Math.round((primary.width - w) / 2),
    y: primary.y + Math.round((primary.height - h) / 2),
  };
}

function snapBoundsToEdge(b) {
  const matched = screen.getDisplayMatching(b);
  const wa = matched.workArea;
  const threshold = 14;
  const margin = 8;
  let nx = b.x;
  let ny = b.y;
  if (Math.abs(b.x - wa.x) <= threshold) nx = wa.x + margin;
  else if (Math.abs((b.x + b.width) - (wa.x + wa.width)) <= threshold) nx = wa.x + wa.width - b.width - margin;
  if (Math.abs(b.y - wa.y) <= threshold) ny = wa.y + margin;
  else if (Math.abs((b.y + b.height) - (wa.y + wa.height)) <= threshold) ny = wa.y + wa.height - b.height - margin;
  return { x: nx, y: ny };
}

function rescueWindowToVisibleArea() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const curBounds = mainWindow.getBounds();
  const safeBounds = ensureVisibleBounds(curBounds);
  if (safeBounds.x !== curBounds.x || safeBounds.y !== curBounds.y || safeBounds.width !== curBounds.width || safeBounds.height !== curBounds.height) {
    mainWindow.setBounds(safeBounds);
  }
  if (isLocked) scheduleReassertBottom(80);
}

function createWindow() {
  const st = loadState();
  const b = ensureVisibleBounds(st.config.bounds);

  isLocked = !!st.config.ui.locked;
  mainWindow = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 680,
    minHeight: 520,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: isLocked ? true : !!st.config.ui.desktopPin,
    minimizable: !isLocked,
    resizable: !isLocked,
    movable: !isLocked,
    backgroundColor: '#00000000',
    icon: buildTrayIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(WEB_DIR, 'index.html'));

  if (process.platform === 'win32') {
    try {
      mainWindow.hookWindowMessage(0x0021, () => {
        if (isLocked) scheduleReassertBottom(45);
      });
    } catch {}
  }
  mainWindow.on('focus', () => {
    if (isLocked) scheduleReassertBottom(45);
  });
  mainWindow.on('show', () => {
    if (isLocked) scheduleReassertBottom(45);
  });
  mainWindow.on('minimize', (e) => {
    if (isLocked) {
      e.preventDefault();
      try { mainWindow.restore(); } catch {}
      scheduleReassertBottom(20);
    }
  });
  mainWindow.webContents.once('did-finish-load', () => {
    sendWinZCommand('SELF', getMainHwndDecimal());
    if (isLocked) applyWindowBottomPin(true);
  });

  let saveBoundsTimer = null;
  const scheduleBoundsSave = () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const cur = loadState();
      const rawBounds = mainWindow.getBounds();
      if (!isLocked && !mainWindow.isMaximized() && cur.config.ui.edgeSnap !== false) {
        const snapped = snapBoundsToEdge(rawBounds);
        if (snapped.x !== rawBounds.x || snapped.y !== rawBounds.y) {
          try { mainWindow.setPosition(snapped.x, snapped.y); } catch {}
          rawBounds.x = snapped.x;
          rawBounds.y = snapped.y;
        }
      }
      cur.config.bounds = rawBounds;
      saveState(cur);
    }, 260);
  };
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    writeCrashLog('render-process-gone', JSON.stringify(details));
    const now = Date.now();
    rendererCrashTimes = rendererCrashTimes.filter(ts => now - ts < 60000);
    rendererCrashTimes.push(now);
    if (rendererCrashTimes.length >= 2) {
      const cur = loadState();
      if (cur.config.ui.frostedBlur !== false) {
        cur.config.ui.frostedBlur = false;
        saveState(cur);
      }
    }
    if (rendererCrashTimes.length <= 3 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });
}

function registerIpc() {
  ipcMain.handle('state:load', () => loadState());
  ipcMain.handle('app:version', () => PKG.version);

  ipcMain.handle('state:save', (_, payload) => {
    const cur = loadState();
    const next = mergeStatePayload(cur, payload);
    saveState(next);
    syncLanServerWithUi(next.config.ui);
    applyGlobalShortcuts(next.config.ui);
    updateTrayMenu();
    return next;
  });

  ipcMain.handle('webdav:test', (_, cfg) => webdav.testConnection(cfg));
  ipcMain.handle('webdav:sync', (_, payload) => runSync(payload && payload.data ? payload.data : null));

  ipcMain.handle('schedule:import', async (_, opts = 'my') => {
    const target = typeof opts === 'string' ? opts : (opts.target || 'my');
    const kind = typeof opts === 'string' ? 'auto' : (opts.kind || 'auto');
    const filterMap = {
      excel: [{ name: 'Excel / CSV 课表', extensions: ['xlsx', 'xls', 'csv'] }],
      word: [{ name: 'Word 课表文档', extensions: ['docx'] }],
      image: [{ name: '课表照片 / 截图', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      auto: [{ name: '全部支持格式（Excel / Word / 照片截图）', extensions: ['xlsx', 'xls', 'csv', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: target === 'class' ? '智能导入班主任班级课表' : '智能导入个人授课课表',
      filters: filterMap[kind] || filterMap.auto,
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const st = loadState();
      const parsed = await excelImport.parseScheduleFile(res.filePaths[0], st.data.timetable.periods);
      return {
        canceled: false,
        ok: true,
        target,
        format: parsed.format,
        courses: parsed.courses,
        detectedPeriods: parsed.detectedPeriods,
        minStartMin: parsed.minStartMin,
        maxEndMin: parsed.maxEndMin,
        hasEvening: parsed.hasEvening,
        hasWeekend: parsed.hasWeekend,
      };
    } catch (err) {
      return { canceled: false, ok: false, message: err.message };
    }
  });

  ipcMain.handle('excel:template', async () => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '保存标准课表模板（含个人课表与班主任班级课表示例）',
      defaultPath: '教师课表导入模板.xlsx',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      excelImport.exportTemplateXlsx(res.filePath);
      return { canceled: false, ok: true, filePath: res.filePath };
    } catch (err) {
      return { canceled: false, ok: false, message: err.message };
    }
  });

  ipcMain.handle('updater:check', async (_, cfg) => {
    const st = loadState();
    const uCfg = cfg || st.config.updater || {};
    return updater.checkForUpdates(uCfg, PKG.version);
  });

  ipcMain.handle('updater:apply', async (_, downloadUrl) => {
    const res = await updater.applyOneClickUpdate(downloadUrl, APP_ROOT);
    if (res.ok) {
      setTimeout(() => {
        app.isQuitting = true;
        app.relaunch();
        app.exit(0);
      }, 900);
    }
    return res;
  });

  ipcMain.handle('win:info', () => ({ locked: isLocked, platform: process.platform }));
  ipcMain.handle('win:is-fullscreen-busy', () => !!winZOtherFullscreen);

  ipcMain.handle('win:options', (_, opts = {}) => {
    const cur = loadState();
    if (typeof opts.locked === 'boolean') setDesktopLock(opts.locked);
    if (typeof opts.desktopPin === 'boolean' && mainWindow) {
      cur.config.ui.desktopPin = opts.desktopPin;
      if (!isLocked) mainWindow.setSkipTaskbar(opts.desktopPin);
    }
    if (typeof opts.autoLaunch === 'boolean') {
      cur.config.ui.autoLaunch = opts.autoLaunch;
      app.setLoginItemSettings({ openAtLogin: opts.autoLaunch, path: process.execPath });
    }
    if (typeof opts.lanEnabled === 'boolean') {
      cur.config.ui.lanEnabled = opts.lanEnabled;
      syncLanServerWithUi(cur.config.ui);
    }
    saveState(cur);
    updateTrayMenu();
    return { locked: isLocked, ui: cur.config.ui };
  });

  ipcMain.handle('win:action', (_, action) => {
    if (action === 'suspend-hotkeys') {
      try { globalShortcut.unregisterAll(); } catch {}
      return;
    }
    if (action === 'resume-hotkeys') {
      applyGlobalShortcuts(loadState().config.ui);
      return;
    }
    if (!mainWindow) return;
    if (action === 'minimize') {
      if (!isLocked) mainWindow.minimize();
      return;
    }
    if (action === 'hide' || action === 'close' || action === 'quit') mainWindow.hide();
    if (action === 'toggle-max') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });

  ipcMain.handle('lan:info', () => (lanServer ? lanServer.getInfo() : { running: false, urls: [] }));
}

app.on('child-process-gone', (_event, details) => {
  writeCrashLog('child-process-gone', JSON.stringify(details));
  if (details && details.type === 'GPU') {
    gpuCrashCount += 1;
    if (gpuCrashCount >= 2) {
      const cur = loadState();
      if (cur.config.ui.frostedBlur !== false) {
        cur.config.ui.frostedBlur = false;
        saveState(cur);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('state:external-update', cur);
        }
      }
    }
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(`教师双图层桌面日历 v${PKG.version}（右键托盘退出）`);
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      if (isLocked) scheduleReassertBottom(30);
      else mainWindow.focus();
    }
  });
  tray.on('double-click', () => {
    if (mainWindow) {
      if (isLocked) setDesktopLock(false);
      mainWindow.show();
      mainWindow.focus();
    }
  });

  lanServer = createLanServer({
    webDir: WEB_DIR,
    port: 18765,
    getState: () => loadState(),
    saveState: (payload) => {
      const cur = loadState();
      const next = mergeStatePayload(cur, payload);
      const saved = saveState(next);
      syncLanServerWithUi(saved.config.ui);
      applyGlobalShortcuts(saved.config.ui);
      updateTrayMenu();
      return saved;
    },
    doSync: (data) => runSync(data),
    doTestWebDav: (cfg) => {
      const curPwd = loadState().config?.webdav?.password || '';
      const resolvedCfg = cfg && cfg.password === '__SAVED__' ? { ...cfg, password: curPwd } : cfg;
      return webdav.testConnection(resolvedCfg);
    },
    notifyDesktopRefresh: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('state:external-update', state);
      }
    },
  });
  syncLanServerWithUi(loadState().config.ui);

  registerIpc();
  ensureWinZHelper();
  createWindow();
  updateTrayMenu();

  screen.on('display-removed', rescueWindowToVisibleArea);
  screen.on('display-metrics-changed', rescueWindowToVisibleArea);
  powerMonitor.on('resume', rescueWindowToVisibleArea);
  powerMonitor.on('unlock-screen', rescueWindowToVisibleArea);

  applyGlobalShortcuts(loadState().config.ui);
});

app.on('will-quit', () => {
  clearTimeout(reassertBottomTimer);
  clearTimeout(reassertFollowTimer);
  if (winZProc) {
    try { winZProc.stdin.end(); } catch {}
    try { winZProc.kill(); } catch {}
    winZProc = null;
  }
  globalShortcut.unregisterAll();
  if (lanServer) lanServer.stop();
});

app.on('window-all-closed', () => {});

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
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
        lanEnabled: true,
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
    },
    lastSyncedAt: null,
  };
}

function loadState() {
  const file = getDataFilePath();
  if (!fs.existsSync(file)) {
    const def = createDefaultState();
    saveState(def);
    return def;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const def = createDefaultState();
    return {
      config: {
        webdav: { ...def.config.webdav, ...(parsed.config?.webdav || {}) },
        updater: { ...def.config.updater, ...(parsed.config?.updater || {}) },
        ui: { ...def.config.ui, ...(parsed.config?.ui || {}) },
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
        classTimetable: parsed.data?.classTimetable && Array.isArray(parsed.data.classTimetable.courses)
          ? parsed.data.classTimetable
          : def.data.classTimetable,
      },
      lastSyncedAt: parsed.lastSyncedAt || null,
    };
  } catch {
    return createDefaultState();
  }
}

function saveState(nextState) {
  const file = getDataFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(nextState, null, 2), 'utf8');
  return nextState;
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

function setDesktopLock(locked) {
  isLocked = !!locked;
  const cur = loadState();
  cur.config.ui.locked = isLocked;
  saveState(cur);
  if (mainWindow && !mainWindow.isDestroyed()) {
    // 锁定后固定窗口位置与长宽高（不再穿透整窗，使核心切换按钮与解锁按钮仍可正常点击）
    mainWindow.setMovable(!isLocked);
    mainWindow.setResizable(!isLocked);
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
    { label: `显示 / 聚焦桌面日历 (v${PKG.version})`, click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    {
      label: isLocked ? '🔓 解锁桌面日历（恢复编辑与拖动）' : '🔒 锁定固定桌面（防误触）',
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
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    { label: lanLabel, enabled: false },
    { label: '快捷键 Ctrl+Alt+L 随时锁定/解锁', enabled: false },
    { type: 'separator' },
    { label: '退出桌面日历', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
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
    };
    st.lastSyncedAt = merged.syncedAt;
    saveState(st);
    return { ok: true, state: st, syncedAt: merged.syncedAt };
  } catch (err) {
    return { ok: false, message: err.message, state: st };
  }
}

function createWindow() {
  const st = loadState();
  const display = screen.getPrimaryDisplay().workArea;
  const defaultBounds = {
    width: Math.min(1160, Math.round(display.width * 0.74)),
    height: Math.min(740, Math.round(display.height * 0.84)),
    x: display.x + Math.round((display.width - Math.min(1160, Math.round(display.width * 0.74))) / 2),
    y: display.y + Math.round((display.height - Math.min(740, Math.round(display.height * 0.84))) / 2),
  };
  const b = st.config.bounds || defaultBounds;

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
    skipTaskbar: !!st.config.ui.desktopPin,
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

  let saveBoundsTimer = null;
  const scheduleBoundsSave = () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const cur = loadState();
      cur.config.bounds = mainWindow.getBounds();
      saveState(cur);
    }, 400);
  };
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function registerIpc() {
  ipcMain.handle('state:load', () => loadState());
  ipcMain.handle('app:version', () => PKG.version);

  ipcMain.handle('state:save', (_, payload) => {
    const cur = loadState();
    const next = {
      ...cur,
      config: payload.config ? { ...cur.config, ...payload.config } : cur.config,
      data: payload.data ? payload.data : cur.data,
      lastSyncedAt: payload.lastSyncedAt !== undefined ? payload.lastSyncedAt : cur.lastSyncedAt,
    };
    saveState(next);
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

  ipcMain.handle('win:options', (_, opts = {}) => {
    const cur = loadState();
    if (typeof opts.locked === 'boolean') setDesktopLock(opts.locked);
    if (typeof opts.desktopPin === 'boolean' && mainWindow) {
      cur.config.ui.desktopPin = opts.desktopPin;
      mainWindow.setSkipTaskbar(opts.desktopPin);
    }
    if (typeof opts.autoLaunch === 'boolean') {
      cur.config.ui.autoLaunch = opts.autoLaunch;
      app.setLoginItemSettings({ openAtLogin: opts.autoLaunch });
    }
    saveState(cur);
    updateTrayMenu();
    return { locked: isLocked, ui: cur.config.ui };
  });

  ipcMain.handle('win:action', (_, action) => {
    if (!mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'hide') mainWindow.hide();
    if (action === 'toggle-max') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
    if (action === 'quit') { app.isQuitting = true; app.quit(); }
  });

  ipcMain.handle('lan:info', () => (lanServer ? lanServer.getInfo() : { running: false, urls: [] }));
}

app.whenReady().then(() => {
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(`教师双图层桌面日历 v${PKG.version}（坚果云同步）`);
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
      const next = {
        ...cur,
        config: payload.config ? { ...cur.config, ...payload.config } : cur.config,
        data: payload.data ? payload.data : cur.data,
      };
      return saveState(next);
    },
    doSync: (data) => runSync(data),
    doTestWebDav: (cfg) => webdav.testConnection(cfg),
    notifyDesktopRefresh: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('state:external-update', state);
      }
    },
  });
  lanServer.start();

  registerIpc();
  createWindow();
  updateTrayMenu();

  globalShortcut.register('CommandOrControl+Alt+L', () => setDesktopLock(!isLocked));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (lanServer) lanServer.stop();
});

app.on('window-all-closed', () => {});

(function () {
  const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEKDAYS_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const WEEKDAYS_ISO = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const LUNAR_MONTHS = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  const LUNAR_DAYS = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
  let PX_PER_MIN = 1.02; // 会随窗口长宽高自适应动态缩放

  let appState = null;
  let currentView = window.innerWidth <= 720 ? 'day' : 'week';
  let anchorDate = new Date();
  let autoSyncTimer = null;
  let pollSyncTimer = null;
  let isSyncing = false;
  let isUiLocked = false;
  let isPrivacyMasked = false;
  let memoMgrFilter = 'all';
  let activeRescheduleCtx = null;
  let activeWorkId = null;
  let activeTtTab = 'my'; // 'my' | 'class' | 'periods'
  let editingTtCourseId = null;
  let activeSettingsTab = 'theme'; // 'theme' | 'cal' | 'memo' | 'adv' | 'update'
  let activeImportTarget = 'class'; // 'my' | 'class'
  let latestUpdateInfo = null;
  let savedPersonalLayers = { showCourse: true, showWork: true };
  let pendingClassScope = null;
  const darkMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const DEFAULT_UI_PREFS = {
    theme: 'auto',
    skinColor: '',
    skinColorName: '默认',
    frostedBlur: true,
    bgAlpha: 72,
    fontFamily: 'system',
    fontSize: 13,
    textMainColor: '',
    todayAccent: '#007aff',
    restColBg: '',
    holidayColor: '#e11d48',
    solarTermColor: '#16a34a',
    autoLaunch: false,
    desktopPin: true,
    reminderEnabled: true,
    magnetSnap: true,
    showEvening: false,
    showWeekend: false,
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
  };

  const FONT_STACK_MAP = {
    system: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif',
    yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    kaiti: '"KaiTi", "STKaiti", "LXGW WenKai", serif',
    songti: '"SimSun", "STSong", "Noto Serif SC", serif',
    mono: '"JetBrains Mono", "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace',
  };

  function ensureUiPrefs() {
    if (!appState) return;
    if (!appState.config) appState.config = {};
    const cur = appState.config.ui || {};
    const defHk = DEFAULT_UI_PREFS.hotkeys;
    const rawHk = cur.hotkeys || {};
    appState.config.ui = {
      ...DEFAULT_UI_PREFS,
      ...cur,
      restWeekdays: Array.isArray(cur.restWeekdays) ? cur.restWeekdays : DEFAULT_UI_PREFS.restWeekdays.slice(),
      hotkeys: {
        hide: { ...defHk.hide, ...(rawHk.hide || {}) },
        priv: { ...defHk.priv, ...(rawHk.priv || {}) },
        lock: { ...defHk.lock, ...(rawHk.lock || {}) },
        memo: { ...defHk.memo, ...(rawHk.memo || {}) },
      },
    };
    return appState.config.ui;
  }

  function formatWorkPrefix(idx) {
    const bs = appState?.config?.ui?.bulletStyle || 'none';
    if (bs === 'number') return `${idx + 1}. `;
    if (bs === 'dot') return '• ';
    return '';
  }

  function getVisibleWorksForDate(ds) {
    const ui = appState?.config?.ui || DEFAULT_UI_PREFS;
    const todayStr = fmtDate(new Date());
    let arr = (appState?.data?.works || []).filter(w => {
      if (w.deleted) return false;
      if (ui.showDoneWork === false && w.done) return false;
      if (w.date === ds) return true;
      if (ui.autoRollover && !w.done && ds === todayStr && w.date < todayStr) {
        const diffDays = Math.round((parseDate(todayStr) - parseDate(w.date)) / 86400000);
        return diffDays >= 1 && diffDays <= 30;
      }
      return false;
    });
    if (ui.doneToBottom !== false) {
      arr = arr.slice().sort((a, b) => (Number(!!a.done) - Number(!!b.done)) || (toMin(a.start) - toMin(b.start)));
    }
    return arr;
  }

  function getLunarParts(d) {
    try {
      const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' }).formatToParts(d);
      const mVal = parseInt(parts.find(p => p.type === 'month')?.value || '0', 10);
      const dVal = parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
      const isLeap = parts.some(p => p.type === 'month' && /闰/.test(p.value));
      if (mVal >= 1 && mVal <= 12 && dVal >= 1 && dVal <= 30) {
        return {
          m: mVal, d: dVal, isLeap,
          full: `农历${isLeap ? '闰' : ''}${LUNAR_MONTHS[mVal]}${LUNAR_DAYS[dVal]}`,
          short: dVal === 1 ? `${isLeap ? '闰' : ''}${LUNAR_MONTHS[mVal]}` : LUNAR_DAYS[dVal],
        };
      }
      return null;
    } catch { return null; }
  }

  function formatLunarText(d) {
    const p = getLunarParts(d);
    if (p) return p.full;
    try {
      return '农历' + new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' }).format(d);
    } catch {
      return '';
    }
  }

  const CN_STATUTORY_MAP = {
    '2025-01-01': { type: 'rest', name: '元旦' },
    '2025-01-26': { type: 'work', name: '补班' },
    '2025-01-28': { type: 'rest', name: '除夕' }, '2025-01-29': { type: 'rest', name: '春节' }, '2025-01-30': { type: 'rest', name: '初二' }, '2025-01-31': { type: 'rest', name: '初三' },
    '2025-02-01': { type: 'rest', name: '初四' }, '2025-02-02': { type: 'rest', name: '初五' }, '2025-02-03': { type: 'rest', name: '初六' }, '2025-02-04': { type: 'rest', name: '初七' },
    '2025-02-08': { type: 'work', name: '补班' },
    '2025-04-04': { type: 'rest', name: '清明' }, '2025-04-05': { type: 'rest', name: '清明休' }, '2025-04-06': { type: 'rest', name: '清明休' },
    '2025-04-27': { type: 'work', name: '补班' },
    '2025-05-01': { type: 'rest', name: '劳动节' }, '2025-05-02': { type: 'rest', name: '五一休' }, '2025-05-03': { type: 'rest', name: '五一休' }, '2025-05-04': { type: 'rest', name: '五一休' }, '2025-05-05': { type: 'rest', name: '五一休' },
    '2025-05-31': { type: 'rest', name: '端午' }, '2025-06-01': { type: 'rest', name: '端午休' }, '2025-06-02': { type: 'rest', name: '端午休' },
    '2025-09-28': { type: 'work', name: '补班' },
    '2025-10-01': { type: 'rest', name: '国庆节' }, '2025-10-02': { type: 'rest', name: '国庆休' }, '2025-10-03': { type: 'rest', name: '国庆休' }, '2025-10-04': { type: 'rest', name: '国庆休' },
    '2025-10-05': { type: 'rest', name: '国庆休' }, '2025-10-06': { type: 'rest', name: '中秋' }, '2025-10-07': { type: 'rest', name: '国庆休' }, '2025-10-08': { type: 'rest', name: '国庆休' },
    '2025-10-11': { type: 'work', name: '补班' },
    '2026-01-01': { type: 'rest', name: '元旦' }, '2026-01-02': { type: 'rest', name: '元旦休' }, '2026-01-03': { type: 'rest', name: '元旦休' }, '2026-01-04': { type: 'work', name: '补班' },
    '2026-02-14': { type: 'work', name: '补班' },
    '2026-02-15': { type: 'rest', name: '春假' }, '2026-02-16': { type: 'rest', name: '除夕' }, '2026-02-17': { type: 'rest', name: '春节' }, '2026-02-18': { type: 'rest', name: '初二' },
    '2026-02-19': { type: 'rest', name: '初三' }, '2026-02-20': { type: 'rest', name: '初四' }, '2026-02-21': { type: 'rest', name: '初五' }, '2026-02-22': { type: 'rest', name: '初六' }, '2026-02-23': { type: 'rest', name: '初七' },
    '2026-02-28': { type: 'work', name: '补班' },
    '2026-04-04': { type: 'rest', name: '清明休' }, '2026-04-05': { type: 'rest', name: '清明' }, '2026-04-06': { type: 'rest', name: '清明休' },
    '2026-05-01': { type: 'rest', name: '劳动节' }, '2026-05-02': { type: 'rest', name: '五一休' }, '2026-05-03': { type: 'rest', name: '五一休' }, '2026-05-04': { type: 'rest', name: '五一休' }, '2026-05-05': { type: 'rest', name: '五一休' },
    '2026-05-09': { type: 'work', name: '补班' },
    '2026-06-19': { type: 'rest', name: '端午' }, '2026-06-20': { type: 'rest', name: '端午休' }, '2026-06-21': { type: 'rest', name: '端午休' },
    '2026-09-20': { type: 'work', name: '补班' },
    '2026-09-25': { type: 'rest', name: '中秋' }, '2026-09-26': { type: 'rest', name: '中秋休' }, '2026-09-27': { type: 'rest', name: '中秋休' },
    '2026-10-01': { type: 'rest', name: '国庆节' }, '2026-10-02': { type: 'rest', name: '国庆休' }, '2026-10-03': { type: 'rest', name: '国庆休' }, '2026-10-04': { type: 'rest', name: '国庆休' },
    '2026-10-05': { type: 'rest', name: '国庆休' }, '2026-10-06': { type: 'rest', name: '国庆休' }, '2026-10-07': { type: 'rest', name: '国庆休' },
    '2026-10-10': { type: 'work', name: '补班' },
    '2027-01-01': { type: 'rest', name: '元旦' }, '2027-01-02': { type: 'rest', name: '元旦休' }, '2027-01-03': { type: 'rest', name: '元旦休' },
    '2027-02-05': { type: 'rest', name: '除夕' }, '2027-02-06': { type: 'rest', name: '春节' }, '2027-02-07': { type: 'rest', name: '初二' }, '2027-02-08': { type: 'rest', name: '初三' },
    '2027-02-09': { type: 'rest', name: '初四' }, '2027-02-10': { type: 'rest', name: '初五' }, '2027-02-11': { type: 'rest', name: '初六' },
    '2027-04-05': { type: 'rest', name: '清明' },
    '2027-05-01': { type: 'rest', name: '劳动节' }, '2027-05-02': { type: 'rest', name: '五一休' }, '2027-05-03': { type: 'rest', name: '五一休' }, '2027-05-04': { type: 'rest', name: '五一休' }, '2027-05-05': { type: 'rest', name: '五一休' },
    '2027-06-09': { type: 'rest', name: '端午' },
    '2027-09-15': { type: 'rest', name: '中秋' },
    '2027-10-01': { type: 'rest', name: '国庆节' }, '2027-10-02': { type: 'rest', name: '国庆休' }, '2027-10-03': { type: 'rest', name: '国庆休' }, '2027-10-04': { type: 'rest', name: '国庆休' },
    '2027-10-05': { type: 'rest', name: '国庆休' }, '2027-10-06': { type: 'rest', name: '国庆休' }, '2027-10-07': { type: 'rest', name: '国庆休' },
  };

  const SOLAR_TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
  const SOLAR_TERM_INFO = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];
  function getSolarTerm(d) {
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const base = Date.UTC(1900, 0, 6, 2, 5);
    for (let i = 0; i < 2; i++) {
      const idx = m * 2 + i;
      const off = 31556925974.7 * (y - 1900) + SOLAR_TERM_INFO[idx] * 60000;
      const dt = new Date(base + off);
      if (dt.getUTCDate() === day) return SOLAR_TERM_NAMES[idx];
    }
    return '';
  }

  const YI_POOL = ['备课批改', '教研交流', '家校沟通', '整理错题', '课件制作', '复盘本周'];
  const JI_POOL = ['熬夜加班', '拖延批阅', '临阵改表', '久坐不歇', '遗漏通知', '堆积待办'];
  function getYiJiText(d) {
    const seed = Math.abs(Math.floor(d.getTime() / 86400000));
    return `宜：${YI_POOL[seed % YI_POOL.length]} · ${YI_POOL[(seed + 2) % YI_POOL.length]} ｜ 忌：${JI_POOL[(seed + 1) % JI_POOL.length]}`;
  }

  function getCnCalendarMeta(d) {
    const ui = appState?.config?.ui || DEFAULT_UI_PREFS;
    const ds = fmtDate(d);
    const md = ds.slice(5);
    const lp = getLunarParts(d);
    const tomLp = getLunarParts(addDays(d, 1));
    const solarFest = { '01-01': '元旦', '05-01': '劳动节', '06-01': '儿童节', '09-10': '教师节', '10-01': '国庆节' }[md]
      || ((d.getMonth() === 3 && d.getDate() === 5) ? '清明' : '');
    const solarTerm = ui.showSolarTerm !== false ? getSolarTerm(d) : '';
    let lunarFest = '';
    if (lp && !lp.isLeap) {
      if (tomLp && !tomLp.isLeap && tomLp.m === 1 && tomLp.d === 1) lunarFest = '除夕';
      else lunarFest = ({ '1-1': '春节', '1-15': '元宵', '5-5': '端午', '7-7': '七夕', '8-15': '中秋', '9-9': '重阳', '12-8': '腊八' })[`${lp.m}-${lp.d}`] || '';
    }
    const dayOv = appState?.data?.dayOverrides && appState.data.dayOverrides[ds];
    const stat = ui.showStatutory !== false ? CN_STATUTORY_MAP[ds] : null;
    let tagType = null, festLabel = '';
    if (dayOv) {
      tagType = dayOv.type === 'holiday' ? 'rest' : 'work';
      festLabel = dayOv.label || (tagType === 'rest' ? '放假' : '补课');
    } else if (stat) {
      tagType = stat.type;
      festLabel = stat.name;
    }
    const festPart = ui.showFestival !== false ? (lunarFest || solarFest) : '';
    const lunarPart = ui.showLunar !== false && lp ? lp.short : '';
    const subText = (festLabel && festLabel !== '补班')
      ? festLabel
      : (festPart || solarTerm || lunarPart || '');
    const yiji = ui.showYiJi ? getYiJiText(d) : '';
    const isoWd = getIsoWeekday(d);
    const restList = Array.isArray(ui.restWeekdays) ? ui.restWeekdays : [6, 7];
    return {
      ds, tagType, festLabel, solarTerm, festPart, lunarPart, subText, yiji,
      isFest: !!(festLabel || festPart || solarTerm),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isRestDay: restList.includes(isoWd),
    };
  }

  function updateTopbarDateLabel() {
    const titleEl = document.getElementById('topbar-full-date');
    const chipEl = document.getElementById('topbar-week-chip');
    const d = anchorDate;
    const ui = appState?.config?.ui || DEFAULT_UI_PREFS;
    const lunar = ui.showLunar !== false ? formatLunarText(d) : '';
    if (titleEl) {
      titleEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS_FULL[d.getDay()]}${lunar ? ' ' + lunar : ''}`;
    }
    if (chipEl && appState) {
      chipEl.style.display = ui.showWeekNum !== false ? '' : 'none';
      const mon = getMondayOf(d);
      const wkNo = getWeekNumber(fmtDate(mon));
      if (currentView === 'month') {
        chipEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      } else {
        const last = addDays(mon, appState.config.ui.showWeekend ? 6 : 4);
        chipEl.textContent = `${wkNo > 0 ? '第' + wkNo + '周 · ' : ''}${mon.getMonth() + 1}.${mon.getDate()}-${last.getMonth() + 1}.${last.getDate()}`;
      }
    }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function getIsoWeekday(d) { const g = d.getDay(); return g === 0 ? 7 : g; }
  function getMondayOf(d) { return addDays(d, -(getIsoWeekday(d) - 1)); }
  function toMin(t) { const [h, m] = (t || '08:00').split(':').map(Number); return h * 60 + m; }
  function fromMin(total) { const c = Math.max(0, Math.min(23 * 60 + 55, Math.round(total))); return `${pad2(Math.floor(c / 60))}:${pad2(c % 60)}`; }
  function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function escapeAttr(s) { return escapeHtml(s); }

  function guessColor(title) {
    if (/历史/.test(title)) return 'sky';
    if (/道法|政治|社政|思政/.test(title)) return 'emerald';
    if (/地理/.test(title)) return 'violet';
    if (/班会|自习|值日|心理/.test(title)) return 'indigo';
    if (/语文|阅读|作文/.test(title)) return 'rose';
    if (/数学/.test(title)) return 'blue';
    if (/英语/.test(title)) return 'cyan';
    if (/科学|物理|化学|生物/.test(title)) return 'teal';
    if (/体育|美术|音乐|信息|劳动/.test(title)) return 'amber';
    return 'sky';
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function getPeriods() {
    const p = appState?.data?.timetable?.periods;
    return (Array.isArray(p) && p.length) ? p : window.SyncBridge.DEFAULT_PERIODS;
  }

  function getWeekNumber(dateStr) {
    const startStr = appState?.data?.timetable?.termStartDate || '2026-09-01';
    const d1 = getMondayOf(parseDate(startStr));
    const d2 = getMondayOf(parseDate(dateStr));
    return Math.floor(Math.round((d2 - d1) / 86400000) / 7) + 1;
  }

  function getTimeRangeMinutes() {
    const ui = appState.config.ui;
    const periods = getPeriods();
    const showEvening = !!ui.showEvening;

    // 根据识别出的作息节次自动校准最左侧时间轴的起止刻度
    const visiblePeriods = showEvening
      ? periods
      : periods.filter(p => toMin(p.start) < 18 * 60);

    let minStart = visiblePeriods.length ? Math.min(...visiblePeriods.map(p => toMin(p.start))) : 8 * 60;
    let maxEnd = visiblePeriods.length ? Math.max(...visiblePeriods.map(p => toMin(p.end))) : 17 * 60;

    if (ui.timeStartHour) minStart = Math.min(minStart, Math.round(ui.timeStartHour * 60));
    const start = Math.max(6 * 60, Math.floor((minStart - 20) / 30) * 30);
    const minEndFloor = showEvening ? 21 * 60 + 30 : 17 * 60 + 30;
    const end = Math.min(23 * 60 + 30, Math.max(minEndFloor, Math.ceil((maxEnd + 25) / 30) * 30));
    return { start, end };
  }

  function resolveEffectiveTheme(mode) {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    if (darkMediaQuery) return darkMediaQuery.matches ? 'dark' : 'light';
    const h = new Date().getHours();
    return (h >= 19 || h < 7) ? 'dark' : 'light';
  }

  // ===== 节次磁吸算法：自动略过课间/午休，直接磁吸到最近的有效节次 =====
  function snapToNearestPeriod(rawCenterMin, range) {
    const periods = getPeriods()
      .filter(p => toMin(p.end) > range.start && toMin(p.start) < range.end)
      .sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!periods.length) return null;
    let best = periods[0];
    let bestDist = Infinity;
    for (const p of periods) {
      const mid = (toMin(p.start) + toMin(p.end)) / 2;
      const dist = Math.abs(rawCenterMin - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return best;
  }

  // ===== 多班级课表管理辅助（上限 3 个班级，兼容旧单班镜像字段） =====
  function ensureClassTimetables() {
    if (!appState || !appState.data) return [];
    const d = appState.data;
    const now = Date.now();
    if (!Array.isArray(d.classTimetables) || !d.classTimetables.length) {
      const legacy = d.classTimetable || {};
      d.classTimetables = [{
        id: legacy.id || 'cls_1',
        className: legacy.className || '902班',
        metaUpdatedAt: legacy.metaUpdatedAt || now,
        courses: Array.isArray(legacy.courses) ? legacy.courses : [],
        overrides: Array.isArray(legacy.overrides) ? legacy.overrides : [],
      }];
    } else {
      d.classTimetables = d.classTimetables
        .filter(ct => !ct.deleted)
        .slice(0, 3)
        .map((ct, i) => ({
          id: ct.id || `cls_${i + 1}`,
          className: ct.className || ct.name || `班级${i + 1}`,
          metaUpdatedAt: ct.metaUpdatedAt || 0,
          courses: Array.isArray(ct.courses) ? ct.courses : [],
          overrides: Array.isArray(ct.overrides) ? ct.overrides : [],
        }));
      if (!d.classTimetables.length) {
        d.classTimetables = [{ id: 'cls_1', className: '902班', metaUpdatedAt: now, courses: [], overrides: [] }];
      }
    }
    if (!d.activeClassId || !d.classTimetables.some(c => c.id === d.activeClassId)) {
      d.activeClassId = d.classTimetables[0].id;
    }
    syncLegacyClassTimetableMirror();
    return d.classTimetables;
  }

  function syncLegacyClassTimetableMirror() {
    if (!appState?.data?.classTimetables?.length) return;
    const active = appState.data.classTimetables.find(c => c.id === appState.data.activeClassId) || appState.data.classTimetables[0];
    appState.data.classTimetable = {
      id: active.id,
      className: active.className,
      metaUpdatedAt: active.metaUpdatedAt || Date.now(),
      courses: active.courses,
      overrides: active.overrides,
    };
  }

  function getActiveClassTt() {
    const list = ensureClassTimetables();
    return list.find(c => c.id === appState.data.activeClassId) || list[0];
  }

  function addNewClassTimetable(nameRaw) {
    const list = ensureClassTimetables();
    if (list.length >= 3) {
      showToast('⚠️ 最多支持管理 3 个班级课表');
      return null;
    }
    const n = list.length + 1;
    const className = String(nameRaw || '').trim() || `新班级${n}`;
    const nc = { id: uid('cls'), className, metaUpdatedAt: Date.now(), courses: [], overrides: [] };
    list.push(nc);
    appState.data.activeClassId = nc.id;
    syncLegacyClassTimetableMirror();
    return nc;
  }

  function renderHomeroomClassTabs() {
    const box = document.getElementById('homeroom-class-tabs');
    const addBtn = document.getElementById('btn-homeroom-add-cls');
    if (!box || !appState?.data) return;
    const list = ensureClassTimetables();
    const cur = getActiveClassTt();
    box.innerHTML = list.map(ct =>
      `<button class="seg-btn ${ct.id === cur.id ? 'active' : ''}" data-switch-cls="${ct.id}">${escapeHtml(ct.className)}</button>`
    ).join('');
    box.querySelectorAll('[data-switch-cls]').forEach(btn => {
      btn.addEventListener('click', async () => {
        appState.data.activeClassId = btn.dataset.switchCls;
        syncLegacyClassTimetableMirror();
        render();
        await persistAndScheduleSync(false);
        showToast(`已切换至「${getActiveClassTt().className}」课表`);
      });
    });
    if (addBtn) {
      addBtn.disabled = list.length >= 3;
      addBtn.textContent = list.length >= 3 ? `已达上限(${list.length}/3)` : `+ 新增班级(${list.length}/3)`;
    }
  }

  // ===== 核心：计算某天生效的课表（支持 source='my' 个人底层课表 / source='class' 班主任班级课表） =====
  function getEffectiveCoursesForDate(dateStr, source = 'my') {
    const d = parseDate(dateStr);
    const dayOv = appState.data.dayOverrides && appState.data.dayOverrides[dateStr];
    const weekday = (dayOv && dayOv.type === 'makeup' && dayOv.sourceWeekday) ? dayOv.sourceWeekday : getIsoWeekday(d);
    const weekNum = getWeekNumber(dateStr);
    const parityNow = weekNum % 2 === 0 ? 'even' : 'odd';

    const activeCls = source === 'class' ? getActiveClassTt() : null;
    const rawCourses = source === 'class'
      ? (activeCls?.courses || [])
      : (appState.data.timetable?.courses || []);
    const rawOverrides = source === 'class'
      ? (activeCls?.overrides || [])
      : (appState.data.overrides || []);

    const courses = rawCourses.filter(c => !c.deleted);
    const overrides = rawOverrides.filter(o => !o.deleted);
    const activeList = [];
    const ghostList = [];

    if (!dayOv || dayOv.type !== 'holiday') {
      courses.forEach(c => {
        if (c.weekday !== weekday) return;
        if (c.parity === 'odd' && parityNow !== 'odd') return;
        if (c.parity === 'even' && parityNow !== 'even') return;

        const ov = overrides.find(o => o.courseId === c.id && o.origDate === dateStr);
        if (!ov) {
          activeList.push({
            source,
            courseId: c.id,
            origDate: dateStr,
            origStart: c.start,
            origEnd: c.end,
            date: dateStr,
            start: c.start,
            end: c.end,
            title: c.title,
            note: c.room || '',
            color: c.color || guessColor(c.title),
            customBg: c.customBg || '',
            isMoved: false,
            overrideId: null,
          });
        } else if (ov.type === 'cancel') {
          ghostList.push({
            source,
            overrideId: ov.id,
            courseId: c.id,
            origDate: dateStr,
            origStart: c.start,
            origEnd: c.end,
            title: c.title,
            label: `已停课 · 原 ${c.title}`,
          });
        } else if (ov.type === 'move') {
          const shortTarget = ov.targetDate === dateStr ? ov.targetStart : `${ov.targetDate.slice(5)} ${ov.targetStart}`;
          ghostList.push({
            source,
            overrideId: ov.id,
            courseId: c.id,
            origDate: dateStr,
            origStart: c.start,
            origEnd: c.end,
            title: c.title,
            label: `已调走 → ${shortTarget} (${c.title})`,
          });
        }
      });
    }

    overrides.forEach(ov => {
      if (ov.type !== 'move' || ov.targetDate !== dateStr) return;
      const base = courses.find(c => c.id === ov.courseId);
      const title = ov.title || (base ? base.title : '调课');
      activeList.push({
        source,
        courseId: ov.courseId,
        origDate: ov.origDate,
        origStart: ov.origStart || (base ? base.start : ov.targetStart),
        origEnd: ov.origEnd || (base ? base.end : ov.targetEnd),
        date: dateStr,
        start: ov.targetStart,
        end: ov.targetEnd,
        title,
        note: ov.note || '',
        color: (base && base.color) || guessColor(title),
        customBg: (base && base.customBg) || '',
        isMoved: true,
        overrideId: ov.id,
      });
    });

    return { activeList, ghostList };
  }

  function findConflictingCourses(dateStr, start, end) {
    const ws = toMin(start), we = toMin(end);
    return getEffectiveCoursesForDate(dateStr, 'my').activeList.filter(
      c => Math.max(ws, toMin(c.start)) < Math.min(we, toMin(c.end))
    );
  }

  // ===== 状态持久化与坚果云同步 =====
  async function persistAndScheduleSync(triggerSync = true) {
    await window.SyncBridge.saveState(appState);
    pushAndroidWidgetSummary();
    if (triggerSync && appState.config.webdav.autoSync && appState.config.webdav.password) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = setTimeout(() => performSync(true), 2000);
    }
  }

  function updateSyncBadge(status, text) {
    const iconBtn = document.getElementById('btn-cloud-icon');
    const banner = document.getElementById('sync-detail-banner');
    if (iconBtn) {
      iconBtn.classList.remove('cloud-ok', 'cloud-syncing', 'cloud-err');
      if (status === 'ok') iconBtn.classList.add('cloud-ok');
      else if (status === 'syncing') iconBtn.classList.add('cloud-syncing');
      else if (status === 'err') iconBtn.classList.add('cloud-err');
      iconBtn.title = text || '坚果云 WebDAV 自动同步';
    }
    if (banner && text) {
      banner.dataset.syncStatus = text;
    }
  }

  function refreshSyncBadgeFromState() {
    const cfg = appState.config.webdav;
    if (!cfg.password) {
      updateSyncBadge('', '尚未填写坚果云同步码（点击进入账户设置）');
      return;
    }
    if (appState.lastSyncedAt) {
      const d = new Date(appState.lastSyncedAt);
      updateSyncBadge('ok', `坚果云已自动同步（上次：${pad2(d.getHours())}:${pad2(d.getMinutes())}）`);
    } else {
      updateSyncBadge('', '坚果云待同步（点击立即检查）');
    }
  }

  async function performSync(silent = false) {
    if (isSyncing) return;
    const cfg = appState.config.webdav;
    if (!cfg.password) {
      if (!silent) showToast('请先填写坚果云第三方应用密码（同步码）');
      refreshSyncBadgeFromState();
      return;
    }
    isSyncing = true;
    updateSyncBadge('syncing', '☁ 同步中…');
    try {
      const res = await window.SyncBridge.syncWebDav(appState);
      if (res && res.ok && res.state) {
        appState = res.state;
        ensureClassTimetables();
        refreshSyncBadgeFromState();
        render();
        pushAndroidWidgetSummary();
        if (!silent) showToast('坚果云四文件双向同步完成');
      } else {
        updateSyncBadge('err', '☁ 同步失败');
        if (!silent) showToast(res?.message || '同步失败');
      }
    } catch (err) {
      updateSyncBadge('err', '☁ 同步异常');
      if (!silent) showToast(err.message);
    } finally {
      isSyncing = false;
    }
  }

  function pushAndroidWidgetSummary() {
    const todayStr = fmtDate(new Date());
    const { activeList } = getEffectiveCoursesForDate(todayStr, 'my');
    const todayWorks = (appState.data.works || []).filter(w => !w.deleted && w.date === todayStr);
    const items = [
      ...activeList.map(c => ({ kind: 'course', start: c.start, end: c.end, title: (c.isMoved ? '[调]' : '') + c.title })),
      ...todayWorks.map(w => ({ kind: 'work', start: w.start, end: w.end, title: (w.done ? '☑ ' : '☐ ') + w.title })),
    ].sort((a, b) => toMin(a.start) - toMin(b.start));
    window.SyncBridge.notifyWidgetSummary(JSON.stringify({ date: todayStr, items }));
  }

  // ===== 互斥模式逻辑：班主任班级课表 vs 个人双图层 =====
  async function setHomeroomMode(enabled) {
    const ui = appState.config.ui;
    if (enabled) {
      if (!ui.homeroomMode) {
        savedPersonalLayers = { showCourse: ui.showCourse !== false, showWork: ui.showWork !== false };
      }
      ui.homeroomMode = true;
      ui.showCourse = false;
      ui.showWork = false;
    } else {
      ui.homeroomMode = false;
      ui.showCourse = savedPersonalLayers.showCourse;
      ui.showWork = savedPersonalLayers.showWork;
    }
    render();
    await persistAndScheduleSync(false);
  }

  function hexToRgb(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return { r, g, b, lum: (0.299 * r + 0.587 * g + 0.114 * b) / 255 };
  }

  // ===== 应用主题与 UI 控件同步 =====
  function applyUiControlsFromState() {
    const ui = appState.config.ui;
    const themeMode = ['light', 'dark', 'auto'].includes(ui.theme) ? ui.theme : 'auto';
    const resolvedTheme = resolveEffectiveTheme(themeMode);
    const rootEl = document.documentElement;
    const skinRgb = hexToRgb(ui.skinColor);

    if (skinRgb) {
      rootEl.setAttribute('data-theme', skinRgb.lum < 0.52 ? 'dark' : 'light');
      rootEl.style.setProperty('--glass-bg', `rgba(${skinRgb.r}, ${skinRgb.g}, ${skinRgb.b}, var(--bg-alpha))`);
      rootEl.style.setProperty('--glass-header', `rgba(${skinRgb.r}, ${skinRgb.g}, ${skinRgb.b}, min(0.98, calc(var(--bg-alpha) * 1.06 + 0.04)))`);
      rootEl.style.setProperty('--glass-subbar', `rgba(${skinRgb.r}, ${skinRgb.g}, ${skinRgb.b}, min(0.94, calc(var(--bg-alpha) * 1.02 + 0.02)))`);
    } else {
      rootEl.setAttribute('data-theme', resolvedTheme);
      rootEl.style.removeProperty('--glass-bg');
      rootEl.style.removeProperty('--glass-header');
      rootEl.style.removeProperty('--glass-subbar');
    }

    document.querySelectorAll('[data-skin-color]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.skinColor.toLowerCase() === String(ui.skinColor || '').toLowerCase());
    });
    const skinNameEl = document.getElementById('skin-color-name');
    if (skinNameEl) skinNameEl.textContent = ui.skinColorName || '默认';
    const customSkinEl = document.getElementById('inp-custom-skin');
    if (customSkinEl && skinRgb) customSkinEl.value = ui.skinColor;

    document.querySelectorAll('[data-theme-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeMode === themeMode);
    });
    const autoBtn = document.querySelector('[data-theme-mode="auto"]');
    if (autoBtn) {
      autoBtn.textContent = themeMode === 'auto'
        ? `🌗 自动(${resolvedTheme === 'dark' ? '夜' : '日'})`
        : '🌗 自动识别';
    }

    const homeroomOn = !!ui.homeroomMode;
    document.body.classList.toggle('homeroom-active', homeroomOn);

    document.getElementById('homeroom-label-text').textContent = '🏫 班级课表';
    const bannerTxtEl = document.getElementById('homeroom-banner-text');
    if (bannerTxtEl) bannerTxtEl.textContent = '🏫 班级课表（★ 为我任教课程）：';
    renderHomeroomClassTabs();

    document.getElementById('chk-homeroom').checked = homeroomOn;
    document.getElementById('pill-homeroom').classList.toggle('active-homeroom', homeroomOn);

    document.getElementById('chk-show-course').checked = !homeroomOn && ui.showCourse !== false;
    document.getElementById('chk-show-work').checked = !homeroomOn && ui.showWork !== false;
    document.getElementById('pill-course').classList.toggle('dimmed', homeroomOn);
    document.getElementById('pill-work').classList.toggle('dimmed', homeroomOn);

    const bgAlpha = typeof ui.bgAlpha === 'number' ? Math.max(0, Math.min(98, ui.bgAlpha)) : 72;
    const bgStyle = bgAlpha <= 15 ? 'transparent' : bgAlpha <= 52 ? 'translucent' : bgAlpha <= 85 ? 'frosted' : 'solid';
    const bgStyleLabels = { transparent: '全透明', translucent: '半透明', frosted: '磨砂玻璃', solid: '实色' };
    rootEl.setAttribute('data-bg-style', bgStyle);
    rootEl.style.setProperty('--bg-alpha', String(bgAlpha / 100));
    rootEl.setAttribute('data-frosted', ui.frostedBlur === false ? 'off' : 'on');
    rootEl.style.setProperty('--app-font', FONT_STACK_MAP[ui.fontFamily] || FONT_STACK_MAP.system);
    rootEl.style.setProperty('--app-font-size', `${Number(ui.fontSize) || 13}px`);
    if (ui.textMainColor) rootEl.style.setProperty('--text-main', ui.textMainColor);
    else rootEl.style.removeProperty('--text-main');

    const accRgb = hexToRgb(ui.todayAccent);
    if (accRgb && ui.todayAccent !== DEFAULT_UI_PREFS.todayAccent) {
      rootEl.style.setProperty('--today-accent', ui.todayAccent);
      rootEl.style.setProperty('--today-col-bg', `rgba(${accRgb.r}, ${accRgb.g}, ${accRgb.b}, 0.06)`);
      rootEl.style.setProperty('--today-hdr-bg', `rgba(${accRgb.r}, ${accRgb.g}, ${accRgb.b}, 0.14)`);
    } else {
      rootEl.style.removeProperty('--today-accent');
      rootEl.style.removeProperty('--today-col-bg');
      rootEl.style.removeProperty('--today-hdr-bg');
    }
    const restRgb = hexToRgb(ui.restColBg);
    if (restRgb && ui.restColBg) rootEl.style.setProperty('--rest-col-bg', `rgba(${restRgb.r}, ${restRgb.g}, ${restRgb.b}, 0.28)`);
    else rootEl.style.removeProperty('--rest-col-bg');
    if (ui.holidayColor && ui.holidayColor !== DEFAULT_UI_PREFS.holidayColor) rootEl.style.setProperty('--holiday-color', ui.holidayColor);
    else rootEl.style.removeProperty('--holiday-color');
    if (ui.solarTermColor && ui.solarTermColor !== DEFAULT_UI_PREFS.solarTermColor) rootEl.style.setProperty('--solar-term-color', ui.solarTermColor);
    else rootEl.style.removeProperty('--solar-term-color');

    document.getElementById('chk-magnet').checked = ui.magnetSnap !== false;
    document.getElementById('rng-course-opacity').value = ui.courseOpacity ?? 78;
    document.getElementById('rng-work-opacity').value = ui.workOpacity ?? 92;
    const bgAlphaSet = document.getElementById('rng-bg-alpha-set');
    if (bgAlphaSet) bgAlphaSet.value = bgAlpha;
    const autoEl = document.getElementById('opt-autolaunch');
    if (autoEl) autoEl.checked = !!ui.autoLaunch;
    const pinEl = document.getElementById('opt-desktop-pin');
    if (pinEl) pinEl.checked = ui.desktopPin !== false;
    const remEl = document.getElementById('opt-reminder');
    if (remEl) remEl.checked = ui.reminderEnabled !== false;
    document.querySelectorAll('[data-bg-style]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bgStyle === bgStyle);
    });
    const readout = document.getElementById('bg-alpha-readout');
    if (readout) readout.textContent = `${bgAlpha}% · ${bgStyleLabels[bgStyle]}`;

    const effThemeForPicker = skinRgb ? (skinRgb.lum < 0.52 ? 'dark' : 'light') : resolvedTheme;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    setChk('sw-frosted-blur', ui.frostedBlur !== false);
    setVal('sel-font-family', ui.fontFamily || 'system');
    setVal('sel-font-scale', String(ui.fontSize || 13));
    setVal('col-text-main', ui.textMainColor || (effThemeForPicker === 'dark' ? '#f8fafc' : '#0f172a'));
    setVal('col-today-accent', ui.todayAccent || DEFAULT_UI_PREFS.todayAccent);
    setVal('col-rest-bg', ui.restColBg || '#eef2ff');
    setVal('col-holiday-text', ui.holidayColor || DEFAULT_UI_PREFS.holidayColor);
    setVal('col-term-text', ui.solarTermColor || DEFAULT_UI_PREFS.solarTermColor);

    setChk('sw-show-weeknum', ui.showWeekNum !== false);
    setChk('sw-show-rest', !!ui.showWeekend);
    const restList = Array.isArray(ui.restWeekdays) ? ui.restWeekdays : [6, 7];
    document.querySelectorAll('[data-rest-wd]').forEach(chk => { chk.checked = restList.includes(Number(chk.dataset.restWd)); });
    setChk('sw-show-stat', ui.showStatutory !== false);
    setChk('sw-show-fest', ui.showFestival !== false);
    setChk('sw-show-lunar', ui.showLunar !== false);
    setChk('sw-show-solarterm', ui.showSolarTerm !== false);
    setChk('sw-show-yiji', !!ui.showYiJi);

    document.querySelectorAll('[data-bullet-style]').forEach(b => b.classList.toggle('active', b.dataset.bulletStyle === (ui.bulletStyle || 'none')));
    setChk('sw-show-done-work', ui.showDoneWork !== false);
    setChk('sw-done-bottom', ui.doneToBottom !== false);
    setChk('sw-auto-rollover', !!ui.autoRollover);
    setVal('sel-done-sound', ui.doneSound || 'ding');
    setVal('sel-rem-sound', ui.remSound || 'chime');

    const hk = ui.hotkeys || DEFAULT_UI_PREFS.hotkeys;
    setVal('hk-hide-key', hk.hide?.key || 'Ctrl+Alt+H');
    setChk('sw-hk-hide', hk.hide?.enabled !== false);
    setVal('hk-priv-key', hk.priv?.key || 'Ctrl+Alt+F');
    setChk('sw-hk-priv', hk.priv?.enabled !== false);
    setVal('hk-lock-key', hk.lock?.key || 'Ctrl+Alt+L');
    setChk('sw-hk-lock', hk.lock?.enabled !== false);
    setVal('hk-memo-key', hk.memo?.key || 'Ctrl+Alt+N');
    setChk('sw-hk-memo', hk.memo?.enabled !== false);

    const btnEvening = document.getElementById('btn-toggle-evening');
    const btnWeekend = document.getElementById('btn-toggle-weekend');
    btnEvening.classList.toggle('active', !!ui.showEvening);
    btnEvening.textContent = ui.showEvening ? '🌃 晚自习：开' : '🌃 展示晚自习';
    btnWeekend.classList.toggle('active', !!ui.showWeekend);
    btnWeekend.textContent = ui.showWeekend ? '📅 周末：开' : '📅 展示周末';

    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === currentView);
    });
  }

  function applyLockUi(locked) {
    isUiLocked = !!locked;
    document.body.classList.toggle('ui-locked', isUiLocked);
    const lockBtn = document.getElementById('btn-lock');
    const lockSvg = document.getElementById('lock-svg');
    const lockKeyLabel = appState?.config?.ui?.hotkeys?.lock?.key || 'Ctrl+Alt+L';
    if (lockBtn) {
      lockBtn.classList.toggle('btn-lock-active', isUiLocked);
      lockBtn.title = isUiLocked
        ? `当前已锁定防误触，点击立即解锁（或按 ${lockKeyLabel}）`
        : '锁定固定防误触（锁定后窗口不可拖动缩放，课表与编辑按钮禁用）';
    }
    if (lockSvg) {
      lockSvg.innerHTML = isUiLocked
        ? '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
        : '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>';
    }
  }

  function updateResponsiveLayout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    document.body.classList.toggle('compact-narrow', w < 860);
    document.body.classList.toggle('compact-short', h < 620);

    // 根据当前窗口可用高度动态匹配 PX_PER_MIN，拉高自动舒展，拉矮保持清晰最小行高
    const vp = document.getElementById('main-viewport');
    if (vp && appState && currentView !== 'month') {
      const availH = Math.max(320, vp.clientHeight - 36);
      const range = getTimeRangeMinutes();
      const totalMin = Math.max(240, range.end - range.start);
      const ideal = availH / totalMin;
      PX_PER_MIN = Math.max(0.72, Math.min(1.45, Number(ideal.toFixed(3))));
    }
  }

  function courseCustomStyle(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '';
    const txt = rgb.lum < 0.54 ? '#f8fafc' : '#0f172a';
    return `background-color:${hex};color:${txt};border-color:rgba(15,23,42,0.22);`;
  }

  function fmtCountdownMin(mins) {
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m}分`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}小时${r}分` : `${h}小时`;
  }

  function renderNextCountdown() {
    const pill = document.getElementById('topbar-next-pill');
    if (!pill || !appState) return;
    const todayStr = fmtDate(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const homeroomOn = !!appState.config.ui.homeroomMode;
    const { activeList } = getEffectiveCoursesForDate(todayStr, homeroomOn ? 'class' : 'my');
    const works = homeroomOn ? [] : (appState.data.works || []).filter(w => !w.deleted && !w.done && w.date === todayStr);
    const items = [
      ...activeList.map(c => ({ s: toMin(c.start), e: toMin(c.end), label: c.title })),
      ...works.map(w => ({ s: toMin(w.start), e: toMin(w.end), label: w.title })),
    ].sort((a, b) => a.s - b.s);
    const cur = items.find(it => nowMin >= it.s && nowMin < it.e);
    if (cur) {
      pill.classList.add('ongoing');
      pill.textContent = `🟢 进行中：${cur.label} · 剩${fmtCountdownMin(cur.e - nowMin)}`;
      return;
    }
    const next = items.find(it => it.s > nowMin);
    pill.classList.remove('ongoing');
    pill.textContent = next ? `🔔 距 ${next.label} 还有${fmtCountdownMin(next.s - nowMin)}` : '✅ 今日后续无日程';
  }

  function render() {
    if (!appState) return;
    ensureClassTimetables();
    ensureUiPrefs();
    applyUiControlsFromState();
    applyLockUi(isUiLocked);
    refreshSyncBadgeFromState();
    updateTopbarDateLabel();
    updateResponsiveLayout();
    renderNextCountdown();
    if (typeof renderInbox === 'function') renderInbox();

    const vp = document.getElementById('main-viewport');
    if (currentView === 'month') renderMonthView(vp);
    else renderTimelineView(vp);
    if (typeof checkReminders === 'function') checkReminders();
  }

  // ===== 渲染周时间轴 / 日时间轴 =====
  function renderTimelineView(container) {
    const ui = appState.config.ui;
    const homeroomOn = !!ui.homeroomMode;
    const todayStr = fmtDate(new Date());
    const range = getTimeRangeMinutes();
    const totalMin = range.end - range.start;
    const canvasHeight = Math.round(totalMin * PX_PER_MIN);
    const periods = getPeriods().slice().sort((a, b) => toMin(a.start) - toMin(b.start));

    let dates = [];
    if (currentView === 'day') {
      dates = [new Date(anchorDate)];
    } else {
      const mon = getMondayOf(anchorDate);
      const count = ui.showWeekend ? 7 : 5;
      for (let i = 0; i < count; i++) dates.push(addDays(mon, i));
    }

    const colTemplate = `58px repeat(${dates.length}, minmax(0, 1fr))`;

    let quickDayStrip = '';
    if (currentView === 'day') {
      const mon = getMondayOf(anchorDate);
      const selStr = fmtDate(anchorDate);
      quickDayStrip = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:5px 10px;background:var(--glass-subbar);border-bottom:1px solid var(--border-soft);flex-shrink:0;">` +
        Array.from({ length: 7 }, (_, i) => {
          const d = addDays(mon, i), ds = fmtDate(d);
          const isSel = ds === selStr, isTd = ds === todayStr;
          return `<button class="btn ${isSel ? 'btn-primary' : ''}" style="padding:3px 2px;font-size:11px;${isTd && !isSel ? 'border-color:var(--apple-blue);color:var(--apple-blue);' : ''}" data-jump-day="${ds}">${WEEKDAYS_ISO[i + 1].replace('周', '')} ${d.getDate()}</button>`;
        }).join('') + `</div>`;
    }

    const headerCells = `<div class="timeline-header-cell" id="time-axis-hdr" title="双击智能批量排作息时间" style="color:var(--text-muted);">时间 ⚡</div>` +
      dates.map(d => {
        const ds = fmtDate(d), isTd = ds === todayStr;
        const meta = getCnCalendarMeta(d);
        const dayOv = appState.data.dayOverrides && appState.data.dayOverrides[ds];
        const badge = dayOv
          ? (dayOv.type === 'holiday' ? `<span class="day-badge holiday">休</span>` : `<span class="day-badge makeup">${escapeHtml(dayOv.label || '补')}</span>`)
          : (meta.tagType === 'rest' ? `<span class="day-badge holiday">休</span>` : (meta.tagType === 'work' ? `<span class="day-badge makeup">班</span>` : ''));
        const termTag = meta.solarTerm ? `<span class="hdr-term-tag">${escapeHtml(meta.solarTerm)}</span>` : '';
        const festTag = (!meta.solarTerm && meta.festPart) ? `<span class="hdr-fest-tag">${escapeHtml(meta.festPart)}</span>` : '';
        const lunarTag = (!termTag && !festTag && meta.lunarPart) ? `<span class="hdr-lunar-sub">${escapeHtml(meta.lunarPart)}</span>` : '';
        const tip = `点击设置法定节假日或周末补课（双击切日/周视图）${meta.yiji ? '\n' + meta.yiji : ''}`;
        return `<div class="timeline-header-cell ${isTd ? 'today' : ''}" data-header-date="${ds}" title="${escapeAttr(tip)}" style="cursor:pointer;">${WEEKDAYS_CN[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}${isTd ? ' · 今天' : ''}${lunarTag}${termTag}${festTag}${badge}</div>`;
      }).join('');

    // 左侧时间刻度 + 节次轻标签 + 苹果日历红色胶囊当前时间
    let ticksHtml = '';
    const firstHour = Math.ceil(range.start / 60);
    const lastHour = Math.floor(range.end / 60);
    for (let h = firstHour; h <= lastHour; h++) {
      const topPx = (h * 60 - range.start) * PX_PER_MIN;
      ticksHtml += `<div class="time-tick" style="top:${topPx}px">${pad2(h)}:00</div>`;
    }
    periods.forEach((p, idx) => {
      const ps = toMin(p.start);
      if (ps >= range.start && ps <= range.end) {
        ticksHtml += `<div class="period-axis-tag" style="top:${(ps - range.start) * PX_PER_MIN + 2}px">${idx + 1}</div>`;
      }
    });

    const nowDate = new Date();
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes() + nowDate.getSeconds() / 60;
    const showNowLine = nowMin >= range.start && nowMin <= range.end;
    const nowTopPx = (nowMin - range.start) * PX_PER_MIN;
    const nowTimeText = `${pad2(nowDate.getHours())}:${pad2(nowDate.getMinutes())}`;

    if (showNowLine) {
      ticksHtml += `<div class="apple-now-pill" id="apple-now-pill" style="top:${nowTopPx}px">${nowTimeText}</div>`;
    }

    // 背景网格线 + 课间/午休微淡带（帮助直观看到磁吸跳过的课间）
    let linesHtml = '';
    for (let h = firstHour; h <= lastHour; h++) {
      const topPx = (h * 60 - range.start) * PX_PER_MIN;
      linesHtml += `<div class="hour-line" style="top:${topPx}px"></div>`;
      if (h < lastHour) linesHtml += `<div class="half-hour-line" style="top:${topPx + 30 * PX_PER_MIN}px"></div>`;
    }
    for (let i = 0; i < periods.length - 1; i++) {
      const bStart = toMin(periods[i].end);
      const bEnd = toMin(periods[i + 1].start);
      if (bEnd > bStart && bEnd > range.start && bStart < range.end) {
        const s = Math.max(bStart, range.start), e = Math.min(bEnd, range.end);
        const h = (e - s) * PX_PER_MIN;
        let label = '';
        if (bStart >= 11 * 60 && bStart <= 14 * 60 && (bEnd - bStart) >= 40) label = '午休';
        else if (bStart >= 16 * 60 && (bEnd - bStart) >= 30) label = '晚读';
        else if (h >= 13) label = '课间';
        linesHtml += `<div class="break-band" style="top:${(s - range.start) * PX_PER_MIN}px;height:${h}px">${label}</div>`;
      }
    }

    const showCourse = !homeroomOn && ui.showCourse !== false;
    const showWork = !homeroomOn && ui.showWork !== false;
    const opCourse = (ui.courseOpacity ?? 78) / 100;
    const opWork = (ui.workOpacity ?? 92) / 100;
    const hasTodayInView = dates.some(d => fmtDate(d) === todayStr);

    const dayColsHtml = dates.map(d => {
      const ds = fmtDate(d);
      const isTd = ds === todayStr;
      const meta = getCnCalendarMeta(d);
      const dayOv = appState.data.dayOverrides && appState.data.dayOverrides[ds];
      let colInner = linesHtml;
      if (dayOv && dayOv.type === 'holiday') {
        colInner += `<div class="holiday-watermark">🏖 ${escapeHtml(dayOv.label || '法定节假日')}<br/><span style="font-weight:500;font-size:10.5px;">已免课休整（点表头可改）</span></div>`;
      }

      // 苹果日历式实时推进红线 + 已流逝时间柔光遮罩
      if (showNowLine) {
        if (isTd) {
          colInner += `<div class="past-curtain" style="height:${nowTopPx}px"></div>`;
          colInner += `<div class="apple-now-line" style="top:${nowTopPx}px"></div>`;
        } else if (hasTodayInView) {
          colInner += `<div class="apple-now-line-faint" style="top:${nowTopPx}px"></div>`;
        }
      }

      // ===== 分支 1：班主任班级课表专属模式（互斥隐藏个人底层课表与顶层干活） =====
      if (homeroomOn) {
        const { activeList, ghostList } = getEffectiveCoursesForDate(ds, 'class');
        ghostList.forEach(g => {
          const s = toMin(g.origStart), e = toMin(g.origEnd);
          if (e <= range.start || s >= range.end) return;
          const top = Math.max(0, (s - range.start) * PX_PER_MIN);
          const height = Math.max(22, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          colInner += `<div class="course-ghost" style="top:${top}px;height:${height}px" data-ghost-source="class" data-ghost-ov="${g.overrideId}">${escapeHtml(g.label)}</div>`;
        });
        activeList.forEach(c => {
          const s = toMin(c.start), e = toMin(c.end);
          if (e <= range.start || s >= range.end) return;
          const top = Math.max(0, (s - range.start) * PX_PER_MIN);
          const height = Math.max(28, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          const isMine = /历史|道法|地理|班会|（张）|\(张\)/.test(c.title);
          colInner += `
            <div class="course-block course-${c.color} ${isMine ? 'my-class-highlight' : ''}" style="top:${top}px;height:${height}px;opacity:0.94;${courseCustomStyle(c.customBg)}"
                 data-course-source="class"
                 data-course-id="${c.courseId}" data-orig-date="${c.origDate}" data-orig-start="${c.origStart}" data-orig-end="${c.origEnd}"
                 data-cur-date="${c.date}" data-cur-start="${c.start}" data-cur-end="${c.end}"
                 data-cur-title="${escapeAttr(c.title)}" data-cur-note="${escapeAttr(c.note)}" data-override-id="${c.overrideId || ''}">
              <div class="course-title">
                ${c.isMoved ? '<span class="badge-moved">调</span>' : ''}
                ${isMine ? '<span title="我任教的课">★</span>' : ''}
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.title)}</span>
              </div>
              ${height >= 26 ? `<div class="course-time">${c.start}-${c.end}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>` : ''}
            </div>`;
        });
        return `<div class="day-col ${isTd ? 'today-col' : ''} ${meta.isRestDay ? 'rest-col' : ''}" data-col-date="${ds}" style="height:${canvasHeight}px">${colInner}</div>`;
      }

      // ===== 分支 2：个人双图层模式（底层我的课表 + 顶层干活叠加） =====
      const { activeList, ghostList } = getEffectiveCoursesForDate(ds, 'my');
      const dayWorks = getVisibleWorksForDate(ds);

      if (showCourse) {
        ghostList.forEach(g => {
          const s = toMin(g.origStart), e = toMin(g.origEnd);
          if (e <= range.start || s >= range.end) return;
          const top = Math.max(0, (s - range.start) * PX_PER_MIN);
          const height = Math.max(22, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          colInner += `<div class="course-ghost" style="top:${top}px;height:${height}px" data-ghost-source="my" data-ghost-ov="${g.overrideId}" title="点击恢复原课表或重新调课">${escapeHtml(g.label)}</div>`;
        });
        activeList.forEach(c => {
          const s = toMin(c.start), e = toMin(c.end);
          if (e <= range.start || s >= range.end) return;
          const top = Math.max(0, (s - range.start) * PX_PER_MIN);
          const height = Math.max(28, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          colInner += `
            <div class="course-block course-${c.color}" style="top:${top}px;height:${height}px;opacity:${opCourse};${courseCustomStyle(c.customBg)}"
                 data-course-source="my"
                 data-course-id="${c.courseId}" data-orig-date="${c.origDate}" data-orig-start="${c.origStart}" data-orig-end="${c.origEnd}"
                 data-cur-date="${c.date}" data-cur-start="${c.start}" data-cur-end="${c.end}"
                 data-cur-title="${escapeAttr(c.title)}" data-cur-note="${escapeAttr(c.note)}" data-override-id="${c.overrideId || ''}"
                 title="按住拖动可磁吸跳过课间单次调课或互换，点击可设置背景色">
              <div class="course-title">
                ${c.isMoved ? '<span class="badge-moved">调</span>' : ''}
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.title)}</span>
              </div>
              ${height >= 26 ? `<div class="course-time">${c.start}-${c.end}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>` : ''}
            </div>`;
        });
      }

      if (showWork) {
        dayWorks.forEach((w, wIdx) => {
          const s = toMin(w.start), e = toMin(w.end);
          if (e <= range.start || s >= range.end) return;
          const isOverlap = showCourse && activeList.some(c => Math.max(s, toMin(c.start)) < Math.min(e, toMin(c.end)));
          const isRolled = w.date !== ds;
          const prefix = formatWorkPrefix(wIdx);
          const top = Math.max(0, (s - range.start) * PX_PER_MIN);
          const height = Math.max(28, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          const cls = ['work-block'];
          if (w.urgent) cls.push('urgent');
          if (isOverlap) cls.push('overlap');
          if (w.done) cls.push('done');
          colInner += `
            <div class="${cls.join(' ')}" style="top:${top}px;height:${height}px;opacity:${opWork}" data-work-id="${w.id}">
              <div class="work-header">
                <span class="work-check" data-toggle-done="${w.id}">${w.done ? '☑' : '☐'}</span>
                <span class="work-title-text">${isRolled ? '<span class="work-rollover-tag">顺延</span>' : ''}${isOverlap ? '⚡ ' : ''}${prefix}${escapeHtml(w.title)}</span>
              </div>
              ${height >= 26 ? `<div class="work-time">${w.start}-${w.end}${w.note ? ' · ' + escapeHtml(w.note) : ''}</div>` : ''}
              <div class="work-resize-handle" data-resize-work="${w.id}" title="上下拖拉调整时长"></div>
            </div>`;
        });
      }

      return `<div class="day-col ${isTd ? 'today-col' : ''} ${meta.isRestDay ? 'rest-col' : ''}" data-col-date="${ds}" style="height:${canvasHeight}px">${colInner}</div>`;
    }).join('');

    container.innerHTML = `
      ${quickDayStrip}
      <div class="timeline-header" style="grid-template-columns:${colTemplate}">${headerCells}</div>
      <div class="timeline-scroll" id="timeline-scroll">
        <div class="timeline-grid" style="grid-template-columns:${colTemplate};height:${canvasHeight}px">
          <div class="time-axis-col" id="time-axis-col" title="双击可智能批量修改全天作息时间" style="height:${canvasHeight}px">${ticksHtml}</div>
          ${dayColsHtml}
        </div>
      </div>
    `;

    bindTimelineInteractions(range);
  }

  function renderMonthView(container) {
    const ui = appState.config.ui;
    const y = anchorDate.getFullYear(), m = anchorDate.getMonth(), todayStr = fmtDate(new Date());
    const homeroomOn = !!ui.homeroomMode;
    const showWeekend = !!ui.showWeekend;
    const showEvening = !!ui.showEvening;
    const range = getTimeRangeMinutes();
    const totalMin = range.end - range.start;
    const nowDate = new Date();
    const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

    const startMon = getMondayOf(new Date(y, m, 1));
    const colCount = showWeekend ? 7 : 5;
    const weekdayHeaders = showWeekend
      ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
      : ['周一', '周二', '周三', '周四', '周五'];

    const cells = [];
    for (let w = 0; w < 6; w++) {
      for (let dIdx = 0; dIdx < colCount; dIdx++) {
        const d = addDays(startMon, w * 7 + dIdx), ds = fmtDate(d);
        const isTd = ds === todayStr;
        const meta = getCnCalendarMeta(d);
        const { activeList } = getEffectiveCoursesForDate(ds, homeroomOn ? 'class' : 'my');
        const visibleCourses = showEvening
          ? activeList
          : activeList.filter(c => toMin(c.start) < 18 * 60);
        const works = homeroomOn
          ? []
          : getVisibleWorksForDate(ds).filter(wk => showEvening || toMin(wk.start) < 18 * 60);

        // 左侧微型纵向按时间比例时间轴
        let miniBars = '';
        if (homeroomOn || ui.showCourse !== false) {
          visibleCourses.forEach(c => {
            const s = Math.max(range.start, toMin(c.start));
            const e = Math.min(range.end, toMin(c.end));
            if (e <= s) return;
            const topPct = ((s - range.start) / totalMin) * 100;
            const hPct = Math.max(6, ((e - s) / totalMin) * 100);
            miniBars += `<div class="mini-axis-course" style="top:${topPct}%;height:${hPct}%" title="${c.start}-${c.end} ${escapeAttr(c.title)}"></div>`;
          });
        }
        if (!homeroomOn && ui.showWork !== false) {
          works.forEach(wk => {
            const s = Math.max(range.start, toMin(wk.start));
            const e = Math.min(range.end, toMin(wk.end));
            if (e <= s) return;
            const overlap = visibleCourses.some(c => Math.max(s, toMin(c.start)) < Math.min(e, toMin(c.end)));
            const topPct = ((s - range.start) / totalMin) * 100;
            const hPct = Math.max(6, ((e - s) / totalMin) * 100);
            miniBars += `<div class="mini-axis-work ${overlap ? 'overlap' : ''}" style="top:${topPct}%;height:${hPct}%" title="${wk.start}-${wk.end} ${escapeAttr(wk.title)}"></div>`;
          });
        }
        if (isTd && nowMin >= range.start && nowMin <= range.end) {
          miniBars += `<div class="mini-axis-now" style="top:${((nowMin - range.start) / totalMin) * 100}%"></div>`;
        }

        // 右侧带时间的紧凑日程条目
        const pills = [];
        if (!homeroomOn && ui.showWork !== false) {
          works.slice(0, 2).forEach((wk, idx) => {
            const isRolled = wk.date !== ds;
            pills.push(`<div class="month-pill work ${wk.urgent ? 'urgent' : ''}">${isRolled ? '<span class="work-rollover-tag">顺延</span>' : ''}${formatWorkPrefix(idx)}${wk.start} ${escapeHtml(wk.title)}</div>`);
          });
        }
        if (homeroomOn || ui.showCourse !== false) {
          const maxShow = homeroomOn ? 3 : Math.max(1, 3 - pills.length);
          visibleCourses.slice(0, maxShow).forEach(c => {
            pills.push(`<div class="month-pill course-item ${c.isMoved ? 'moved' : ''}">${c.isMoved ? '[调]' : ''}${c.start} ${escapeHtml(c.title)}</div>`);
          });
          if (visibleCourses.length > maxShow) {
            pills.push(`<div class="month-pill" style="color:var(--text-muted);">+${visibleCourses.length - maxShow} 节课</div>`);
          }
        }

        const dayOv = appState.data.dayOverrides && appState.data.dayOverrides[ds];
        const mBadge = dayOv
          ? (dayOv.type === 'holiday' ? `<span class="day-badge holiday">休</span>` : `<span class="day-badge makeup">${escapeHtml(dayOv.label || '补')}</span>`)
          : (meta.tagType === 'rest' ? `<span class="day-badge holiday">休</span>` : (meta.tagType === 'work' ? `<span class="day-badge makeup">班</span>` : ''));
        const subTag = meta.solarTerm
          ? `<span style="font-size:9.5px;color:var(--solar-term-color);font-weight:700;">${escapeHtml(meta.solarTerm)}</span>`
          : (meta.festPart ? `<span style="font-size:9.5px;color:var(--holiday-color);font-weight:700;">${escapeHtml(meta.festPart)}</span>` : `<span style="font-size:9.5px;color:var(--text-muted);">${escapeHtml(meta.lunarPart)}</span>`);
        cells.push(`
          <div class="month-cell ${d.getMonth() !== m ? 'other-month' : ''} ${isTd ? 'today' : ''} ${meta.isRestDay ? 'rest-day-cell' : ''}" data-month-date="${ds}" title="${escapeAttr(meta.yiji || '')}">
            <div class="month-cell-top">
              <span>${d.getDate()}日${mBadge} ${subTag}</span>
              <span style="font-size:10px;color:${isTd ? 'var(--today-accent)' : 'var(--text-muted)'};">${isTd ? '今天' : `${visibleCourses.length}课${works.length ? '·' + works.length + '活' : ''}`}</span>
            </div>
            <div class="month-cell-body">
              <div class="mini-axis-track" title="当日时间轴缩略（蓝=上课，橙=干活，红=撞课）">${miniBars}</div>
              <div class="month-entry-list">${pills.join('')}</div>
            </div>
          </div>`);
      }
    }

    const gridStyle = `grid-template-columns:repeat(${colCount}, minmax(0, 1fr))`;
    container.innerHTML = `
      <div class="month-view">
        <div class="month-weekdays" style="${gridStyle}">${weekdayHeaders.map(h => `<div>${h}</div>`).join('')}</div>
        <div class="month-grid" style="${gridStyle}">${cells.join('')}</div>
      </div>`;
    container.querySelectorAll('[data-month-date]').forEach(el => {
      el.addEventListener('click', () => {
        anchorDate = parseDate(el.dataset.monthDate);
        currentView = window.innerWidth <= 720 ? 'day' : 'week';
        render();
      });
    });
  }

  // ===== 时间轴交互：双击最左侧时间轴批量排作息、节次磁吸拖拽调课、干活拖拽、空白点击添加 =====
  function bindTimelineInteractions(range) {
    const axisCol = document.getElementById('time-axis-col');
    const axisHdr = document.getElementById('time-axis-hdr');
    if (axisCol) axisCol.addEventListener('dblclick', (e) => { e.stopPropagation(); openBellBatchModal(); });
    if (axisHdr) axisHdr.addEventListener('dblclick', (e) => { e.stopPropagation(); openBellBatchModal(); });

    document.querySelectorAll('[data-jump-day]').forEach(btn => {
      btn.addEventListener('click', () => { anchorDate = parseDate(btn.dataset.jumpDay); render(); });
    });
    document.querySelectorAll('[data-header-date]').forEach(el => {
      el.addEventListener('click', () => {
        if (!isUiLocked) openDayModeModal(el.dataset.headerDate);
      });
    });

    document.querySelectorAll('[data-ghost-ov]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const source = el.dataset.ghostSource || 'my';
        const ovId = el.dataset.ghostOv;
        const activeCls = source === 'class' ? getActiveClassTt() : null;
        const ovList = source === 'class' ? (activeCls?.overrides || []) : (appState.data.overrides || []);
        const cList = source === 'class' ? (activeCls?.courses || []) : (appState.data.timetable?.courses || []);
        const ov = ovList.find(o => o.id === ovId);
        if (!ov) return;
        const c = cList.find(x => x.id === ov.courseId);
        openRescheduleModal({
          source,
          courseId: ov.courseId, origDate: ov.origDate,
          origStart: ov.origStart || (c ? c.start : '08:00'), origEnd: ov.origEnd || (c ? c.end : '08:40'),
          curDate: ov.targetDate || ov.origDate, curStart: ov.targetStart || ov.origStart || (c ? c.start : '08:00'),
          curEnd: ov.targetEnd || ov.origEnd || (c ? c.end : '08:40'),
          title: ov.title || (c ? c.title : '课程'), note: ov.note || '', overrideId: ov.id,
        });
      });
    });

    document.querySelectorAll('[data-toggle-done]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const w = (appState.data.works || []).find(x => x.id === el.dataset.toggleDone);
        if (w) {
          w.done = !w.done;
          w.updatedAt = Date.now();
          if (w.done && appState.config.ui.doneSound !== 'none') playSoundEffect(appState.config.ui.doneSound);
          render();
          await persistAndScheduleSync();
        }
      });
    });

    document.querySelectorAll('.course-block').forEach(block => {
      block.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        startBlockDrag(e, block, 'course', range);
      });
    });

    document.querySelectorAll('.work-block').forEach(block => {
      block.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.dataset.toggleDone) return;
        e.stopPropagation();
        if (e.target.dataset.resizeWork) startWorkResize(e, block, range);
        else startBlockDrag(e, block, 'work', range);
      });
    });

    document.querySelectorAll('.day-col').forEach(col => {
      col.addEventListener('click', (e) => {
        if (e.target !== col || appState.config.ui.homeroomMode) return;
        const relY = e.clientY - col.getBoundingClientRect().top;
        const snapped = Math.floor((range.start + relY / PX_PER_MIN) / 15) * 15;
        openWorkModal(null, { date: col.dataset.colDate, start: fromMin(snapped), end: fromMin(Math.min(range.end, snapped + 60)) });
      });
    });
  }

  function startBlockDrag(startEvent, blockEl, kind, range) {
    const startX = startEvent.clientX, startY = startEvent.clientY;
    const grabOffsetY = startY - blockEl.getBoundingClientRect().top;
    const courseSource = blockEl.dataset.courseSource || 'my';

    let durMin = 40;
    if (kind === 'course') {
      durMin = toMin(blockEl.dataset.curEnd) - toMin(blockEl.dataset.curStart);
    } else {
      const w = appState.data.works.find(x => x.id === blockEl.dataset.workId);
      if (!w) return;
      durMin = toMin(w.end) - toMin(w.start);
    }

    let moved = false;
    let previewEl = null;
    let magnetGlowEl = null;
    let swapTargetEl = null;
    let targetDate = null;
    let targetStartStr = null;
    let targetEndStr = null;

    function clearVisuals() {
      if (previewEl) { previewEl.remove(); previewEl = null; }
      if (magnetGlowEl) { magnetGlowEl.remove(); magnetGlowEl = null; }
      if (swapTargetEl) { swapTargetEl.classList.remove('swap-target-highlight'); swapTargetEl = null; }
    }

    function findSwapCandidate(hoveredCol, ev, sMin, eMin) {
      const sel = kind === 'course'
        ? `.course-block[data-course-source="${courseSource}"]`
        : '.work-block';
      const candidates = Array.from(hoveredCol.querySelectorAll(sel)).filter(el => {
        if (el === blockEl) return false;
        if (kind === 'work' && el.dataset.workId === blockEl.dataset.workId) return false;
        return true;
      });
      // 1) Prefer direct pointer hit inside candidate block
      const directHit = candidates.find(el => {
        const r = el.getBoundingClientRect();
        return ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      if (directHit) return directHit;

      // 2) Otherwise pick strongest time-slot overlap after snapping
      let bestEl = null;
      let bestOverlap = 0;
      for (const el of candidates) {
        let cStart = 0, cEnd = 0;
        if (kind === 'course') {
          cStart = toMin(el.dataset.curStart);
          cEnd = toMin(el.dataset.curEnd);
        } else {
          const w = appState.data.works.find(x => x.id === el.dataset.workId);
          if (!w) continue;
          cStart = toMin(w.start);
          cEnd = toMin(w.end);
        }
        const ov = Math.min(eMin, cEnd) - Math.max(sMin, cStart);
        const minThreshold = Math.min(15, Math.min(eMin - sMin, cEnd - cStart) * 0.4);
        if (ov >= minThreshold && ov > bestOverlap) {
          bestOverlap = ov;
          bestEl = el;
        }
      }
      return bestEl;
    }

    function onMove(ev) {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      if (!moved) { moved = true; blockEl.classList.add('dragging'); }

      const cols = Array.from(document.querySelectorAll('.day-col'));
      const hoveredCol = cols.find(c => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right; });
      if (!hoveredCol) return;

      const colRect = hoveredCol.getBoundingClientRect();
      const topY = ev.clientY - colRect.top - grabOffsetY;
      const rawStart = range.start + topY / PX_PER_MIN;
      const rawCenter = rawStart + durMin / 2;

      targetDate = hoveredCol.dataset.colDate;

      // 课表与待办均启用「🧲 节次磁吸」（按住 Alt 键可临时解除磁吸自由拖放）
      const useMagnet = (appState.config.ui.magnetSnap !== false) && !ev.altKey;
      let snappedPeriod = useMagnet ? snapToNearestPeriod(rawCenter, range) : null;

      let sMin, eMin, label;
      if (snappedPeriod) {
        sMin = toMin(snappedPeriod.start);
        eMin = toMin(snappedPeriod.end);
        targetStartStr = snappedPeriod.start;
        targetEndStr = snappedPeriod.end;
        label = `${kind === 'course' ? '🧲 磁吸' : '📌 磁吸'} ${snappedPeriod.label} · ${targetStartStr}-${targetEndStr}`;
      } else {
        sMin = Math.max(range.start, Math.min(range.end - durMin, Math.round(rawStart / 5) * 5));
        eMin = sMin + durMin;
        targetStartStr = fromMin(sMin);
        targetEndStr = fromMin(eMin);
        label = `${kind === 'course' ? '🔄 调课至' : '📌 移至'} ${targetDate.slice(5)} ${targetStartStr}-${targetEndStr}`;
      }

      if (previewEl && previewEl.parentElement !== hoveredCol) clearVisuals();

      const nextSwap = findSwapCandidate(hoveredCol, ev, sMin, eMin);
      if (swapTargetEl && swapTargetEl !== nextSwap) {
        swapTargetEl.classList.remove('swap-target-highlight');
      }
      swapTargetEl = nextSwap;

      let previewStart = sMin;
      let previewEnd = eMin;
      if (swapTargetEl) {
        swapTargetEl.classList.add('swap-target-highlight');
        if (kind === 'course') {
          previewStart = toMin(swapTargetEl.dataset.curStart);
          previewEnd = toMin(swapTargetEl.dataset.curEnd);
          label = `⇄ 对调位置：与「${swapTargetEl.dataset.curTitle || '目标课程'}」互换`;
        } else {
          const tw = appState.data.works.find(x => x.id === swapTargetEl.dataset.workId);
          if (tw) {
            previewStart = toMin(tw.start);
            previewEnd = toMin(tw.end);
            label = `⇄ 对调位置：与「${tw.title || '目标待办'}」互换`;
          }
        }
      }

      if (snappedPeriod && !swapTargetEl) {
        if (!magnetGlowEl) {
          magnetGlowEl = document.createElement('div');
          magnetGlowEl.className = 'magnet-slot-glow';
          hoveredCol.appendChild(magnetGlowEl);
        }
        magnetGlowEl.style.top = `${(sMin - range.start) * PX_PER_MIN}px`;
        magnetGlowEl.style.height = `${Math.max(24, (eMin - sMin) * PX_PER_MIN)}px`;
      } else if (magnetGlowEl) {
        magnetGlowEl.remove();
        magnetGlowEl = null;
      }

      if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.className = 'drag-preview';
        hoveredCol.appendChild(previewEl);
      }
      previewEl.className = swapTargetEl ? 'drag-preview swap-mode' : 'drag-preview';
      previewEl.style.top = `${(previewStart - range.start) * PX_PER_MIN}px`;
      previewEl.style.height = `${Math.max(24, (previewEnd - previewStart) * PX_PER_MIN)}px`;
      previewEl.textContent = label;
    }

    async function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      blockEl.classList.remove('dragging');
      const dropSwapEl = swapTargetEl;
      clearVisuals();

      if (!moved) {
        if (kind === 'course') {
          openRescheduleModal({
            source: courseSource,
            courseId: blockEl.dataset.courseId, origDate: blockEl.dataset.origDate,
            origStart: blockEl.dataset.origStart, origEnd: blockEl.dataset.origEnd,
            curDate: blockEl.dataset.curDate, curStart: blockEl.dataset.curStart, curEnd: blockEl.dataset.curEnd,
            title: blockEl.dataset.curTitle, note: blockEl.dataset.curNote, overrideId: blockEl.dataset.overrideId || null,
          });
        } else {
          openWorkModal(blockEl.dataset.workId);
        }
        return;
      }

      if (dropSwapEl) {
        if (kind === 'course') {
          await applyCourseSwap(
            {
              source: courseSource,
              courseId: blockEl.dataset.courseId, origDate: blockEl.dataset.origDate,
              origStart: blockEl.dataset.origStart, origEnd: blockEl.dataset.origEnd,
              curDate: blockEl.dataset.curDate, curStart: blockEl.dataset.curStart, curEnd: blockEl.dataset.curEnd,
              title: blockEl.dataset.curTitle, note: blockEl.dataset.curNote,
              overrideId: blockEl.dataset.overrideId || null,
            },
            {
              source: courseSource,
              courseId: dropSwapEl.dataset.courseId, origDate: dropSwapEl.dataset.origDate,
              origStart: dropSwapEl.dataset.origStart, origEnd: dropSwapEl.dataset.origEnd,
              curDate: dropSwapEl.dataset.curDate, curStart: dropSwapEl.dataset.curStart, curEnd: dropSwapEl.dataset.curEnd,
              title: dropSwapEl.dataset.curTitle, note: dropSwapEl.dataset.curNote,
              overrideId: dropSwapEl.dataset.overrideId || null,
            }
          );
        } else {
          const wA = appState.data.works.find(x => x.id === blockEl.dataset.workId);
          const wB = appState.data.works.find(x => x.id === dropSwapEl.dataset.workId);
          if (wA && wB) {
            const tmp = { date: wA.date, start: wA.start, end: wA.end };
            wA.date = wB.date; wA.start = wB.start; wA.end = wB.end;
            wB.date = tmp.date; wB.start = tmp.start; wB.end = tmp.end;
            const now = Date.now();
            wA.updatedAt = now;
            wB.updatedAt = now;
            render();
            await persistAndScheduleSync();
            showToast(`⇄ 待办已对调：「${wA.title}」↔「${wB.title}」`);
          }
        }
        return;
      }

      if (!targetDate || !targetStartStr || !targetEndStr) return;

      if (kind === 'course') {
        await applySingleCourseMove({
          source: courseSource,
          courseId: blockEl.dataset.courseId, origDate: blockEl.dataset.origDate,
          origStart: blockEl.dataset.origStart, origEnd: blockEl.dataset.origEnd,
          title: blockEl.dataset.curTitle, note: blockEl.dataset.curNote,
          overrideId: blockEl.dataset.overrideId || null,
          targetDate, targetStart: targetStartStr, targetEnd: targetEndStr,
        });
      } else {
        const w = appState.data.works.find(x => x.id === blockEl.dataset.workId);
        if (w) {
          w.date = targetDate; w.start = targetStartStr; w.end = targetEndStr; w.updatedAt = Date.now();
          render();
          await persistAndScheduleSync();
          const cf = findConflictingCourses(targetDate, targetStartStr, targetEndStr);
          showToast(cf.length ? `已移动（⚡ 与 ${cf[0].title} 重叠）` : `已移至 ${targetDate.slice(5)} ${targetStartStr}-${targetEndStr}`);
        }
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startWorkResize(startEvent, blockEl, range) {
    const w = appState.data.works.find(x => x.id === blockEl.dataset.workId);
    if (!w) return;
    const startY = startEvent.clientY, startMin = toMin(w.start), origEndMin = toMin(w.end);
    let nextEndMin = origEndMin;
    function onMove(ev) {
      nextEndMin = Math.max(startMin + 15, Math.min(range.end, Math.round((origEndMin + (ev.clientY - startY) / PX_PER_MIN) / 5) * 5));
      blockEl.style.height = `${(nextEndMin - startMin) * PX_PER_MIN}px`;
      const tEl = blockEl.querySelector('.work-time');
      if (tEl) tEl.textContent = `${w.start}-${fromMin(nextEndMin)}`;
    }
    async function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (nextEndMin !== origEndMin) { w.end = fromMin(nextEndMin); w.updatedAt = Date.now(); render(); await persistAndScheduleSync(); }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function upsertCourseMoveOverride(list, item, targetDate, targetStart, targetEnd, now) {
    if (targetDate === item.origDate && targetStart === item.origStart && targetEnd === item.origEnd) {
      if (item.overrideId) {
        const existing = list.find(o => o.id === item.overrideId);
        if (existing) { existing.deleted = true; existing.updatedAt = now; }
      }
      return true;
    }

    const ov = item.overrideId
      ? list.find(o => o.id === item.overrideId)
      : list.find(o => o.courseId === item.courseId && o.origDate === item.origDate);

    if (!ov) {
      list.push({
        id: uid('ov'), courseId: item.courseId, origDate: item.origDate,
        origStart: item.origStart, origEnd: item.origEnd, type: 'move',
        targetDate, targetStart, targetEnd,
        title: item.title, note: item.note || '', updatedAt: now, deleted: false,
      });
    } else {
      Object.assign(ov, {
        type: 'move', targetDate, targetStart, targetEnd,
        title: item.title, note: item.note || '', deleted: false, updatedAt: now,
      });
    }
    return false;
  }

  // ===== 班级课表修改/对调生效范围确认 + 自动同步个人授课课表 =====
  function findMatchingMyCourse(clsName, origWd, origStart, clsTitle) {
    const clsKey = String(clsName || '').replace(/班$/, '').trim();
    const sMin = toMin(origStart);
    const slotMatches = (appState.data.timetable?.courses || []).filter(
      mc => !mc.deleted && mc.weekday === origWd && Math.abs(toMin(mc.start) - sMin) <= 5
    );
    if (!slotMatches.length) return null;
    if (clsKey) {
      const exact = slotMatches.find(mc => (mc.title || '').includes(clsKey) || (mc.room || '').includes(clsKey));
      if (exact) return exact;
    }
    return slotMatches.find(mc => {
      const dig = (mc.title || '').match(/\d{3}/);
      if (dig && clsKey && dig[0] !== clsKey) return false;
      const clean = String(clsTitle || '').replace(/[（(][^）)]*[）)]/g, '').trim();
      return clean && ((mc.title || '').includes(clean) || clean.includes((mc.title || '').replace(/\d{3}/g, '').trim()));
    }) || null;
  }

  function applyMyCourseSingleOverride(mc, fromDateStr, toDateStr, toStart, toEnd, now) {
    if (!mc) return;
    if (!Array.isArray(appState.data.overrides)) appState.data.overrides = [];
    const active = getEffectiveCoursesForDate(fromDateStr, 'my').activeList.find(x => x.courseId === mc.id);
    upsertCourseMoveOverride(appState.data.overrides, {
      courseId: mc.id,
      origDate: active ? active.origDate : fromDateStr,
      origStart: active ? active.origStart : mc.start,
      origEnd: active ? active.origEnd : mc.end,
      title: mc.title,
      overrideId: active ? (active.overrideId || null) : null,
    }, toDateStr, toStart, toEnd, now);
  }

  function promptClassChangeScope(payload) {
    pendingClassScope = payload;
    const { mode, cls } = payload;
    let desc = '';
    const syncNotes = [];
    if (mode === 'swap') {
      const wdA = getIsoWeekday(parseDate(payload.a.curDate));
      const wdB = getIsoWeekday(parseDate(payload.b.curDate));
      const myA = findMatchingMyCourse(cls.className, wdA, payload.a.curStart, payload.a.title);
      const myB = findMatchingMyCourse(cls.className, wdB, payload.b.curStart, payload.b.title);
      payload.myA = myA;
      payload.myB = (myB && myB !== myA) ? myB : null;
      desc = `将在「<strong>${escapeHtml(cls.className)}</strong>」中对调：<br/>• <strong>${escapeHtml(payload.a.title)}</strong>（${payload.a.curDate.slice(5)} ${payload.a.curStart}-${payload.a.curEnd}）↔ <strong>${escapeHtml(payload.b.title)}</strong>（${payload.b.curDate.slice(5)} ${payload.b.curStart}-${payload.b.curEnd}）`;
      if (payload.myA) syncNotes.push(`「${escapeHtml(payload.myA.title)}」`);
      if (payload.myB) syncNotes.push(`「${escapeHtml(payload.myB.title)}」`);
    } else if (mode === 'move') {
      const wdA = getIsoWeekday(parseDate(payload.item.origDate));
      payload.myA = findMatchingMyCourse(cls.className, wdA, payload.item.origStart, payload.item.title);
      desc = `将在「<strong>${escapeHtml(cls.className)}</strong>」中把 <strong>${escapeHtml(payload.item.title)}</strong> 从 ${payload.item.origDate.slice(5)} ${payload.item.origStart}-${payload.item.origEnd} 调整至 <strong>${payload.targetDate.slice(5)} ${payload.targetStart}-${payload.targetEnd}</strong>。`;
      if (payload.myA) syncNotes.push(`「${escapeHtml(payload.myA.title)}」`);
    } else {
      payload.myA = findMatchingMyCourse(cls.className, payload.origWd, payload.origStart, payload.origTitle);
      desc = `将在「<strong>${escapeHtml(cls.className)}</strong>」中修改 <strong>${escapeHtml(payload.origTitle)}</strong> → <strong>${escapeHtml(payload.nextTitle)}</strong>（${WEEKDAYS_ISO[payload.nextWd]} ${payload.nextStart}-${payload.nextEnd}）。`;
      if (payload.myA) syncNotes.push(`「${escapeHtml(payload.myA.title)}」`);
    }
    if (syncNotes.length) {
      desc += `<div style="margin-top:5px;color:var(--apple-blue);font-weight:600;">🔗 已检测到你任教的个人课表课程：${syncNotes.join('、')}，确认后将自动同步调整！</div>`;
    }
    document.getElementById('cscope-desc').innerHTML = desc;
    openModal('modal-class-scope');
  }

  async function executeClassScope(scope) {
    const p = pendingClassScope;
    if (!p) return;
    pendingClassScope = null;
    closeModal('modal-class-scope');
    const now = Date.now();
    const { cls } = p;
    if (!Array.isArray(cls.overrides)) cls.overrides = [];

    if (scope === 'week') {
      if (p.mode === 'swap') {
        upsertCourseMoveOverride(cls.overrides, p.a, p.b.curDate, p.b.curStart, p.b.curEnd, now);
        upsertCourseMoveOverride(cls.overrides, p.b, p.a.curDate, p.a.curStart, p.a.curEnd, now);
        applyMyCourseSingleOverride(p.myA, p.a.curDate, p.b.curDate, p.b.curStart, p.b.curEnd, now);
        applyMyCourseSingleOverride(p.myB, p.b.curDate, p.a.curDate, p.a.curStart, p.a.curEnd, now);
      } else if (p.mode === 'move') {
        upsertCourseMoveOverride(cls.overrides, p.item, p.targetDate, p.targetStart, p.targetEnd, now);
        applyMyCourseSingleOverride(p.myA, p.item.origDate, p.targetDate, p.targetStart, p.targetEnd, now);
      } else {
        const mon = getMondayOf(anchorDate);
        const fromDate = p.origDate || fmtDate(addDays(mon, p.origWd - 1));
        const toDate = p.nextTargetDate || fmtDate(addDays(mon, p.nextWd - 1));
        upsertCourseMoveOverride(cls.overrides, {
          courseId: p.course.id,
          origDate: fromDate,
          origStart: p.origStart,
          origEnd: p.origEnd,
          title: p.nextTitle,
          note: p.note || '',
          overrideId: p.overrideId || null,
        }, toDate, p.nextStart, p.nextEnd, now);
        applyMyCourseSingleOverride(p.myA, fromDate, toDate, p.nextStart, p.nextEnd, now);
      }
      cls.metaUpdatedAt = now;
      syncLegacyClassTimetableMirror();
      render();
      if (!document.getElementById('modal-timetable').classList.contains('hidden')) renderTimetableManager();
      await persistAndScheduleSync();
      showToast(`📅 已设为仅本周调整${(p.myA || p.myB) ? '（已同步个人本周调课）' : ''}`);
      return;
    }

    // scope === 'term': 后续至本学期一直生效 -> 永久更新固定「班级课表」并自动同步改「我的授课课表」
    let syncedCount = 0;
    if (p.mode === 'swap') {
      const cA = cls.courses.find(x => x.id === p.a.courseId);
      const cB = cls.courses.find(x => x.id === p.b.courseId);
      const wdA = getIsoWeekday(parseDate(p.a.curDate));
      const wdB = getIsoWeekday(parseDate(p.b.curDate));
      if (cA) Object.assign(cA, { weekday: wdB, start: p.b.curStart, end: p.b.curEnd, updatedAt: now });
      if (cB) Object.assign(cB, { weekday: wdA, start: p.a.curStart, end: p.a.curEnd, updatedAt: now });
      cls.overrides.forEach(o => { if (o.courseId === p.a.courseId || o.courseId === p.b.courseId) { o.deleted = true; o.updatedAt = now; } });
      if (p.myA) {
        Object.assign(p.myA, { weekday: wdB, start: p.b.curStart, end: p.b.curEnd, updatedAt: now });
        (appState.data.overrides || []).forEach(o => { if (o.courseId === p.myA.id) { o.deleted = true; o.updatedAt = now; } });
        syncedCount++;
      }
      if (p.myB) {
        Object.assign(p.myB, { weekday: wdA, start: p.a.curStart, end: p.a.curEnd, updatedAt: now });
        (appState.data.overrides || []).forEach(o => { if (o.courseId === p.myB.id) { o.deleted = true; o.updatedAt = now; } });
        syncedCount++;
      }
    } else if (p.mode === 'move') {
      const cA = cls.courses.find(x => x.id === p.item.courseId);
      const wdT = getIsoWeekday(parseDate(p.targetDate));
      if (cA) Object.assign(cA, { weekday: wdT, start: p.targetStart, end: p.targetEnd, updatedAt: now });
      cls.overrides.forEach(o => { if (o.courseId === p.item.courseId) { o.deleted = true; o.updatedAt = now; } });
      if (p.myA) {
        Object.assign(p.myA, { weekday: wdT, start: p.targetStart, end: p.targetEnd, updatedAt: now });
        (appState.data.overrides || []).forEach(o => { if (o.courseId === p.myA.id) { o.deleted = true; o.updatedAt = now; } });
        syncedCount++;
      }
    } else {
      Object.assign(p.course, {
        title: p.nextTitle,
        weekday: p.nextWd,
        start: p.nextStart,
        end: p.nextEnd,
        parity: p.nextParity || p.course.parity || 'all',
        color: p.nextColor || p.course.color,
        customBg: p.nextCustomBg !== undefined ? p.nextCustomBg : p.course.customBg,
        updatedAt: now,
      });
      cls.overrides.forEach(o => { if (o.courseId === p.course.id) { o.deleted = true; o.updatedAt = now; } });
      if (p.myA) {
        Object.assign(p.myA, {
          weekday: p.nextWd,
          start: p.nextStart,
          end: p.nextEnd,
          parity: p.nextParity || p.myA.parity || 'all',
          updatedAt: now,
        });
        (appState.data.overrides || []).forEach(o => { if (o.courseId === p.myA.id) { o.deleted = true; o.updatedAt = now; } });
        syncedCount++;
      }
    }
    cls.metaUpdatedAt = now;
    if (syncedCount && appState.data.timetable) appState.data.timetable.metaUpdatedAt = now;
    syncLegacyClassTimetableMirror();
    render();
    if (!document.getElementById('modal-timetable').classList.contains('hidden')) renderTimetableManager();
    await persistAndScheduleSync();
    showToast(`📆 本学期课表已永久更新${syncedCount ? `，并已自动同步「我的授课课表」${syncedCount} 门课程` : ''}`);
  }

  async function applySingleCourseMove(params) {
    if (params.source === 'class') {
      promptClassChangeScope({
        mode: 'move',
        cls: getActiveClassTt(),
        item: params,
        targetDate: params.targetDate,
        targetStart: params.targetStart,
        targetEnd: params.targetEnd,
      });
      return;
    }
    const now = Date.now();
    const list = appState.data.overrides;

    const restored = upsertCourseMoveOverride(list, params, params.targetDate, params.targetStart, params.targetEnd, now);
    render(); await persistAndScheduleSync();
    showToast(restored
      ? '已恢复到原定上课节次'
      : `单次调课成功：已磁吸至 ${params.targetDate.slice(5)} ${params.targetStart}-${params.targetEnd}`);
  }

  async function applyCourseSwap(a, b) {
    if (a.source === 'class') {
      promptClassChangeScope({
        mode: 'swap',
        cls: getActiveClassTt(),
        a,
        b,
      });
      return;
    }
    const now = Date.now();
    const list = appState.data.overrides;

    upsertCourseMoveOverride(list, a, b.curDate, b.curStart, b.curEnd, now);
    upsertCourseMoveOverride(list, b, a.curDate, a.curStart, a.curEnd, now);
    render(); await persistAndScheduleSync();
    showToast(`⇄ 课表已对调：「${a.title}」↔「${b.title}」`);
  }

  let rsColorCtx = { color: 'sky', customBg: '' };
  const RS_COLOR_NAMES = { sky: '天空蓝', emerald: '护眼翠绿', violet: '优雅浅紫', indigo: '沉稳靛蓝', rose: '温柔玫粉', blue: '晴空浅蓝', cyan: '清澈青色', teal: '薄荷松绿', amber: '暖阳琥珀' };
  function syncRsColorSelection() {
    document.querySelectorAll('[data-rs-color]').forEach(b => b.classList.toggle('active', !rsColorCtx.customBg && b.dataset.rsColor === rsColorCtx.color));
    const lbl = document.getElementById('rs-color-label');
    if (lbl) lbl.textContent = rsColorCtx.customBg ? `自定义 ${rsColorCtx.customBg.toUpperCase()}` : (RS_COLOR_NAMES[rsColorCtx.color] || '系统配色');
    const inp = document.getElementById('rs-custom-color');
    if (inp && rsColorCtx.customBg) inp.value = rsColorCtx.customBg;
  }

  // ===== 弹窗逻辑 =====
  function openRescheduleModal(ctx) {
    activeRescheduleCtx = ctx;
    const isClass = ctx.source === 'class';
    const activeCls = isClass ? getActiveClassTt() : null;
    const cList = isClass ? (activeCls?.courses || []) : (appState.data.timetable?.courses || []);
    const baseCourse = cList.find(c => c.id === ctx.courseId);
    rsColorCtx = {
      color: (baseCourse && baseCourse.color) || guessColor(ctx.title),
      customBg: (baseCourse && baseCourse.customBg) || '',
    };
    syncRsColorSelection();
    document.getElementById('rs-modal-title').textContent = isClass
      ? `🔄 ${activeCls?.className || '班级'}课表设置 / 调课`
      : '🔄 个人课表设置 / 单次调课';
    document.getElementById('rs-origin-info').innerHTML =
      `原定上课：<strong>${ctx.origDate}（${WEEKDAYS_CN[parseDate(ctx.origDate).getDay()]}）${ctx.origStart}-${ctx.origEnd}</strong>` +
      (ctx.overrideId ? ' · <span style="color:var(--apple-orange);">当前已有单次调课/停课记录</span>' : '');
    document.getElementById('rs-title').value = ctx.title;
    document.getElementById('rs-target-date').value = ctx.curDate;
    document.getElementById('rs-target-start').value = ctx.curStart;
    document.getElementById('rs-target-end').value = ctx.curEnd;
    document.getElementById('rs-note').value = ctx.note || '';
    document.getElementById('btn-rs-restore').style.display = ctx.overrideId ? 'inline-flex' : 'none';

    const sel = document.getElementById('rs-period-quick');
    sel.innerHTML = `<option value="">-- 一键磁吸选节次 --</option>` +
      getPeriods().map((p, idx) => `<option value="${idx}">${p.label}（${p.start}-${p.end}）</option>`).join('');
    openModal('modal-reschedule');
  }

  function openWorkModal(workId, defaults = null) {
    activeWorkId = workId;
    const wkBox = document.querySelector('#modal-work .modal');
    if (wkBox) { wkBox.style.transform = ''; wkBox.dataset.dragOx = '0'; wkBox.dataset.dragOy = '0'; }
    const w = workId ? appState.data.works.find(x => x.id === workId) : null;
    document.getElementById('wk-modal-title').textContent = w ? '✏️ 编辑待办事项' : '📌 添加待办事项';
    const aiRawEl = document.getElementById('wk-ai-raw');
    if (aiRawEl) aiRawEl.value = '';
    document.getElementById('wk-title').value = w ? w.title : '';
    document.getElementById('wk-date').value = w ? w.date : (defaults?.date || fmtDate(anchorDate));
    document.getElementById('wk-start').value = w ? w.start : (defaults?.start || '09:00');
    document.getElementById('wk-end').value = w ? w.end : (defaults?.end || '09:50');
    document.getElementById('wk-urgent').checked = w ? !!w.urgent : false;
    document.getElementById('wk-done').checked = w ? !!w.done : false;
    document.getElementById('wk-note').value = w ? (w.note || '') : '';
    document.getElementById('btn-wk-delete').classList.toggle('hidden', !w);
    updateWorkConflictPreview();
    openModal('modal-work');
    setTimeout(() => document.getElementById(w ? 'wk-title' : 'wk-ai-raw')?.focus(), 30);
  }

  function updateWorkConflictPreview() {
    const d = document.getElementById('wk-date').value, s = document.getElementById('wk-start').value, e = document.getElementById('wk-end').value;
    const box = document.getElementById('wk-conflict-warn');
    if (!d || !s || !e || toMin(e) <= toMin(s)) { box.classList.add('hidden'); return; }
    const cf = findConflictingCourses(d, s, e);
    if (cf.length) {
      box.textContent = `⚡ 撞课提醒：该时段与底层课表重叠（${cf.map(c => `${c.start}-${c.end} ${c.title}`).join('、')}）。`;
      box.classList.remove('hidden');
    } else box.classList.add('hidden');
  }

  function renderTimetableManager() {
    document.querySelectorAll('[data-tt-tab]').forEach(b => b.classList.toggle('active', b.dataset.ttTab === activeTtTab));
    const isPeriods = activeTtTab === 'periods';
    document.getElementById('tt-panel-courses').style.display = isPeriods ? 'none' : 'flex';
    document.getElementById('tt-panel-periods').style.display = isPeriods ? 'flex' : 'none';

    if (isPeriods) {
      const periods = getPeriods();
      const tbody = document.getElementById('tt-periods-tbody');
      tbody.innerHTML = periods.map((p, idx) => `
        <tr>
          <td><input class="input" style="padding:3px 7px;width:96px;" value="${escapeAttr(p.label)}" data-pd-field="label" data-pd-idx="${idx}" /></td>
          <td><input type="time" class="input" style="padding:3px 7px;width:104px;" value="${p.start}" data-pd-field="start" data-pd-idx="${idx}" /></td>
          <td><input type="time" class="input" style="padding:3px 7px;width:104px;" value="${p.end}" data-pd-field="end" data-pd-idx="${idx}" /></td>
          <td><button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" data-pd-del="${idx}">删除</button></td>
        </tr>`).join('');

      tbody.querySelectorAll('[data-pd-field]').forEach(inp => {
        inp.addEventListener('change', async () => {
          const i = Number(inp.dataset.pdIdx);
          appState.data.timetable.periods[i][inp.dataset.pdField] = inp.value;
          appState.data.timetable.metaUpdatedAt = Date.now();
          render(); await persistAndScheduleSync();
          showToast('已更新磁吸节次时间');
        });
      });
      tbody.querySelectorAll('[data-pd-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          appState.data.timetable.periods.splice(Number(btn.dataset.pdDel), 1);
          appState.data.timetable.metaUpdatedAt = Date.now();
          renderTimetableManager(); render(); await persistAndScheduleSync();
        });
      });
      const cntEl = document.getElementById('tt-course-count');
      if (cntEl) cntEl.textContent = `作息节次表：共 ${periods.length} 个磁吸节次`;
      return;
    }

    const isClass = activeTtTab === 'class';
    const classList = ensureClassTimetables();
    const activeCls = getActiveClassTt();

    document.getElementById('tt-meta-my').style.display = isClass ? 'none' : 'flex';
    const clsBar = document.getElementById('tt-class-bar');
    if (clsBar) clsBar.style.display = isClass ? 'flex' : 'none';
    document.getElementById('tt-term-start').value = appState.data.timetable.termStartDate || '2026-09-01';

    if (isClass) {
      const chips = document.getElementById('tt-class-chips');
      if (chips) {
        chips.innerHTML = classList.map(ct =>
          `<button class="seg-btn ${ct.id === activeCls.id ? 'active' : ''}" data-tt-cls="${ct.id}">${escapeHtml(ct.className)}</button>`
        ).join('');
        chips.querySelectorAll('[data-tt-cls]').forEach(b => b.addEventListener('click', async () => {
          appState.data.activeClassId = b.dataset.ttCls;
          editingTtCourseId = null;
          syncLegacyClassTimetableMirror();
          renderTimetableManager();
          if (appState.config.ui.homeroomMode) render();
          await persistAndScheduleSync(false);
        }));
      }
      document.getElementById('tt-class-name').value = activeCls.className || '902班';
      const addClsBtn = document.getElementById('btn-tt-add-cls');
      if (addClsBtn) {
        addClsBtn.disabled = classList.length >= 3;
        addClsBtn.textContent = classList.length >= 3 ? `已达上限(${classList.length}/3)` : `+ 新增班级(${classList.length}/3)`;
      }
      const delClsBtn = document.getElementById('btn-tt-del-cls');
      if (delClsBtn) delClsBtn.disabled = classList.length <= 1;
    }

    const pSel = document.getElementById('tt-add-period');
    pSel.innerHTML = `<option value="">选节次自动填时</option>` +
      getPeriods().map((p, idx) => `<option value="${idx}">${p.label} ${p.start}</option>`).join('');

    const rawList = isClass ? activeCls.courses : (appState.data.timetable?.courses || []);
    const list = rawList.filter(c => !c.deleted).sort((a, b) => a.weekday - b.weekday || toMin(a.start) - toMin(b.start));
    const cntEl = document.getElementById('tt-course-count');
    if (cntEl) {
      cntEl.textContent = isClass
        ? `${activeCls.className}：共 ${list.length} 节（最多支持管理 3 个班级）`
        : `我的授课课表：共 ${list.length} 节（双击行内可直接修改）`;
    }
    const parityText = { all: '每周', odd: '单周', even: '双周' };
    const tbody = document.getElementById('tt-course-tbody');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:18px;">暂无课程，可在上方快速添加或点击「✨ 智能导入」</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(c => {
      if (c.id === editingTtCourseId) {
        return `<tr data-row-editing="${c.id}" style="background:rgba(0,122,255,0.10);">
          <td><select class="select" data-ed-wd style="width:66px;padding:3px 4px;">${[1, 2, 3, 4, 5, 6, 7].map(w => `<option value="${w}" ${w === c.weekday ? 'selected' : ''}>${WEEKDAYS_ISO[w]}</option>`).join('')}</select></td>
          <td style="white-space:nowrap;"><input type="time" class="input" data-ed-s value="${c.start}" style="width:82px;padding:2px 4px;" />-<input type="time" class="input" data-ed-e value="${c.end}" style="width:82px;padding:2px 4px;" /></td>
          <td><input type="text" class="input" data-ed-t value="${escapeAttr(c.title)}" style="width:100%;min-width:110px;padding:3px 6px;" /></td>
          <td><select class="select" data-ed-p style="width:66px;padding:3px 4px;">${Object.entries(parityText).map(([k, v]) => `<option value="${k}" ${(c.parity || 'all') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn btn-primary" data-save-course="${c.id}" style="padding:2px 8px;font-size:11px;">保存</button>
            <button class="btn" data-cancel-course style="padding:2px 7px;font-size:11px;">取消</button>
          </td>
        </tr>`;
      }
      return `<tr data-tt-row="${c.id}" title="双击此行可直接编辑星期、时间、名称或单双周">
        <td>${WEEKDAYS_ISO[c.weekday] || '周一'}</td>
        <td style="white-space:nowrap;">${c.start} - ${c.end}</td>
        <td><strong>${escapeHtml(c.title)}</strong></td>
        <td>${parityText[c.parity || 'all'] || '每周'}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn" style="padding:2px 8px;font-size:11px;" data-edit-course="${c.id}">编辑</button>
          <button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" data-del-course="${c.id}">删除</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-tt-row]').forEach(tr => tr.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      editingTtCourseId = tr.dataset.ttRow;
      renderTimetableManager();
      setTimeout(() => tbody.querySelector('[data-ed-t]')?.focus(), 20);
    }));
    tbody.querySelectorAll('[data-edit-course]').forEach(btn => btn.addEventListener('click', () => {
      editingTtCourseId = btn.dataset.editCourse;
      renderTimetableManager();
      setTimeout(() => tbody.querySelector('[data-ed-t]')?.focus(), 20);
    }));
    tbody.querySelectorAll('[data-cancel-course]').forEach(btn => btn.addEventListener('click', () => {
      editingTtCourseId = null;
      renderTimetableManager();
    }));
    async function commitTtRowEdit(cid) {
      const row = tbody.querySelector(`[data-row-editing="${cid}"]`);
      if (!row) return;
      const title = row.querySelector('[data-ed-t]').value.trim();
      const start = row.querySelector('[data-ed-s]').value;
      const end = row.querySelector('[data-ed-e]').value;
      const weekday = Number(row.querySelector('[data-ed-wd]').value);
      const parity = row.querySelector('[data-ed-p]').value;
      if (!title || !start || !end || toMin(end) <= toMin(start)) {
        showToast('请填写课程名称和正确起止时间'); return;
      }
      const c = rawList.find(x => x.id === cid);
      editingTtCourseId = null;
      if (!c) { renderTimetableManager(); return; }
      const changed = c.title !== title || c.start !== start || c.end !== end || c.weekday !== weekday || (c.parity || 'all') !== parity;
      if (isClass && changed) {
        promptClassChangeScope({
          mode: 'edit',
          cls: activeCls,
          course: c,
          origWd: c.weekday,
          origStart: c.start,
          origEnd: c.end,
          origTitle: c.title,
          nextWd: weekday,
          nextStart: start,
          nextEnd: end,
          nextTitle: title,
          nextParity: parity,
        });
        return;
      }
      const now = Date.now();
      Object.assign(c, { title, start, end, weekday, parity, color: c.color || guessColor(title), updatedAt: now });
      if (appState.data.timetable) appState.data.timetable.metaUpdatedAt = now;
      renderTimetableManager(); render(); await persistAndScheduleSync();
      showToast('已保存课程修改');
    }
    tbody.querySelectorAll('[data-save-course]').forEach(btn => btn.addEventListener('click', () => commitTtRowEdit(btn.dataset.saveCourse)));
    tbody.querySelectorAll('[data-row-editing] input').forEach(inp => inp.addEventListener('keydown', (e) => {
      const cid = inp.closest('[data-row-editing]')?.dataset.rowEditing;
      if (!cid) return;
      if (e.key === 'Enter') { e.preventDefault(); commitTtRowEdit(cid); }
      else if (e.key === 'Escape') { editingTtCourseId = null; renderTimetableManager(); }
    }));
    tbody.querySelectorAll('[data-del-course]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const now = Date.now();
        const c = rawList.find(x => x.id === btn.dataset.delCourse);
        if (c) {
          c.deleted = true; c.updatedAt = now;
          if (isClass) { activeCls.metaUpdatedAt = now; syncLegacyClassTimetableMirror(); }
          renderTimetableManager(); render(); await persistAndScheduleSync();
        }
      });
    });
  }

  function openSyncModal() {
    const cfg = appState.config.webdav || {};
    document.getElementById('dav-url').value = cfg.serverUrl || 'https://dav.jianguoyun.com/dav/';
    document.getElementById('dav-user').value = cfg.username || '2465179479@qq.com';
    document.getElementById('dav-folder').value = cfg.folder || 'TeacherCal';
    document.getElementById('dav-pass').value = cfg.password || '';
    document.getElementById('dav-auto').checked = cfg.autoSync !== false;
    document.getElementById('dav-test-result').classList.add('hidden');
    openModal('modal-sync');
  }

  function switchSettingsTab(tab) {
    const mapped = tab === 'desktop' ? 'adv' : tab;
    activeSettingsTab = ['theme', 'cal', 'memo', 'adv', 'update'].includes(mapped) ? mapped : 'theme';
    document.querySelectorAll('[data-set-tab]').forEach(b => b.classList.toggle('active', b.dataset.setTab === activeSettingsTab));
    ['theme', 'cal', 'memo', 'adv', 'update'].forEach(t => {
      const el = document.getElementById(`set-panel-${t}`);
      if (el) el.style.display = t === activeSettingsTab ? 'flex' : 'none';
    });
  }

  async function openSettingsModal(tab = 'theme') {
    ensureUiPrefs();
    const ui = appState.config.ui;
    const uCfg = appState.config.updater || {};

    const ver = await window.SyncBridge.getAppVersion();
    document.getElementById('upd-cur-ver').textContent = `v${ver}`;
    document.getElementById('upd-source').value = uCfg.sourceUrl || '';
    document.getElementById('upd-auto-check').checked = uCfg.autoCheck !== false;
    renderUpdateStatusBox(latestUpdateInfo);

    if (window.SyncBridge.mode === 'desktop') {
      document.getElementById('opt-autolaunch').checked = !!ui.autoLaunch;
      document.getElementById('opt-desktop-pin').checked = !!ui.desktopPin;
      const lan = await window.SyncBridge.getLanInfo();
      document.getElementById('lan-url-box').innerHTML = (lan.urls && lan.urls.length)
        ? `📱 <strong>手机同 Wi-Fi 访问地址</strong>：<code>${lan.urls.join(' / ')}</code>`
        : '未检测到局域网 IP。';
    }
    applyUiControlsFromState();
    switchSettingsTab(tab);
    openModal('modal-settings');
  }

  function renderUpdateStatusBox(info) {
    const box = document.getElementById('upd-status-box');
    const applyBtn = document.getElementById('btn-upd-apply');
    if (!info) {
      box.classList.add('hidden');
      applyBtn.classList.add('hidden');
      return;
    }
    box.className = info.ok ? 'hint-box' : 'warn-box';
    box.innerHTML = `<strong>${escapeHtml(info.message)}</strong>` +
      (info.notes ? `<div style="margin-top:6px;white-space:pre-wrap;opacity:0.9;">${escapeHtml(info.notes)}</div>` : '');
    box.classList.remove('hidden');
    applyBtn.classList.toggle('hidden', !(info.ok && info.hasUpdate && info.downloadUrl));
  }

  async function runUpdateCheck(silent = false) {
    const uCfg = appState.config.updater || {};
    const res = await window.SyncBridge.checkUpdate(uCfg);
    latestUpdateInfo = res;
    const menuBtn = document.getElementById('btn-plugin-menu');
    if (menuBtn) {
      menuBtn.classList.toggle('has-update-dot', !!(res.ok && res.hasUpdate));
    }
    if (res.ok && res.hasUpdate) {
      if (!silent) showToast(`发现新版本 v${res.latestVersion}，可在设置中一键更新`);
    } else if (!silent) {
      showToast(res.message || '检查完成');
    }
    renderUpdateStatusBox(res);
  }

  // ===== 菜单支撑功能：搜索、便签管理、AI 排程、自动周报 =====
  function closeAllMenus() {
    document.getElementById('menu-plugin')?.classList.add('hidden');
  }

  function toggleDropdownMenu(menuId, anchorEl) {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const wasHidden = menu.classList.contains('hidden');
    closeAllMenus();
    if (!wasHidden) return;
    const rect = anchorEl.getBoundingClientRect();
    menu.classList.remove('hidden');
    const mw = menu.offsetWidth || 200;
    const left = Math.max(8, Math.min(window.innerWidth - mw - 8, rect.right - mw));
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${left}px`;
  }

  function openSearchModal(focusDate = false) {
    document.getElementById('srch-jump-date').value = fmtDate(anchorDate);
    document.getElementById('srch-input').value = '';
    renderSearchResults('');
    openModal('modal-search');
    setTimeout(() => {
      const el = document.getElementById(focusDate ? 'srch-jump-date' : 'srch-input');
      if (el) el.focus();
    }, 40);
  }

  function renderSearchResults(q) {
    const kw = String(q || '').trim().toLowerCase();
    const box = document.getElementById('srch-results');
    const works = (appState.data.works || []).filter(w => !w.deleted);
    const myCourses = (appState.data.timetable?.courses || []).filter(c => !c.deleted);
    const allClassTts = ensureClassTimetables();
    const items = [];

    works.forEach(w => {
      const hay = `${w.title} ${w.note || ''} ${w.date}`.toLowerCase();
      if (!kw || hay.includes(kw)) {
        items.push({ kind: '📌 干活', title: w.title, sub: `${w.date} ${w.start}-${w.end}${w.done ? ' (已完成)' : ''}`, date: w.date });
      }
    });
    myCourses.forEach(c => {
      if (!kw || c.title.toLowerCase().includes(kw)) {
        const mon = getMondayOf(anchorDate);
        const dStr = fmtDate(addDays(mon, (c.weekday || 1) - 1));
        items.push({ kind: '📚 课表', title: c.title, sub: `${WEEKDAYS_ISO[c.weekday]} ${c.start}-${c.end}`, date: dStr });
      }
    });
    allClassTts.forEach(ct => {
      (ct.courses || []).filter(c => !c.deleted).forEach(c => {
        if (kw && (`${ct.className} ${c.title}`).toLowerCase().includes(kw)) {
          const mon = getMondayOf(anchorDate);
          const dStr = fmtDate(addDays(mon, (c.weekday || 1) - 1));
          items.push({ kind: `🏫 ${ct.className}`, title: c.title, sub: `${WEEKDAYS_ISO[c.weekday]} ${c.start}-${c.end}`, date: dStr });
        }
      });
    });

    if (!items.length) {
      box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:18px;">暂无匹配记录</div>';
      return;
    }
    box.innerHTML = items.slice(0, 30).map(it => `
      <div class="mgr-row" data-srch-date="${it.date}" style="cursor:pointer;">
        <div><strong>${escapeHtml(it.kind)}</strong> · ${escapeHtml(it.title)}</div>
        <span style="color:var(--text-muted);font-size:11.5px;">${escapeHtml(it.sub)} ↗</span>
      </div>`).join('');
    box.querySelectorAll('[data-srch-date]').forEach(row => {
      row.addEventListener('click', () => {
        anchorDate = parseDate(row.dataset.srchDate);
        closeModal('modal-search');
        render();
      });
    });
  }

  function renderMemoMgrList() {
    const ui = appState?.config?.ui || DEFAULT_UI_PREFS;
    const list = (appState.data.works || [])
      .filter(w => !w.deleted)
      .filter(w => memoMgrFilter === 'all' ? true : (memoMgrFilter === 'done' ? w.done : !w.done))
      .sort((a, b) => {
        if (ui.doneToBottom !== false && !!a.done !== !!b.done) return Number(!!a.done) - Number(!!b.done);
        return a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start);
      });
    const box = document.getElementById('memo-mgr-list');
    if (!list.length) {
      box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:18px;">当前筛选下暂无便签/干活记录</div>';
      return;
    }
    box.innerHTML = list.map((w, idx) => `
      <div class="mgr-row">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
          <button class="btn" style="padding:2px 7px;" data-mm-toggle="${w.id}">${w.done ? '☑' : '☐'}</button>
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;${w.done ? 'text-decoration:line-through;opacity:0.6;' : ''}">${w.urgent ? '🔴 ' : ''}${formatWorkPrefix(idx)}${escapeHtml(w.title)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${w.date} ${w.start}-${w.end}${w.note ? ' · ' + escapeHtml(w.note) : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn lock-disabled" style="padding:2px 8px;font-size:11px;" data-mm-edit="${w.id}">编辑</button>
          <button class="btn btn-danger lock-disabled" style="padding:2px 8px;font-size:11px;" data-mm-del="${w.id}">删</button>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-mm-toggle]').forEach(b => b.addEventListener('click', async () => {
      const w = appState.data.works.find(x => x.id === b.dataset.mmToggle);
      if (w) {
        w.done = !w.done;
        w.updatedAt = Date.now();
        if (w.done && appState.config.ui.doneSound !== 'none') playSoundEffect(appState.config.ui.doneSound);
        renderMemoMgrList(); render(); await persistAndScheduleSync();
      }
    }));
    box.querySelectorAll('[data-mm-edit]').forEach(b => b.addEventListener('click', () => {
      closeModal('modal-memo-mgr');
      openWorkModal(b.dataset.mmEdit);
    }));
    box.querySelectorAll('[data-mm-del]').forEach(b => b.addEventListener('click', async () => {
      const w = appState.data.works.find(x => x.id === b.dataset.mmDel);
      if (w) { w.deleted = true; w.updatedAt = Date.now(); renderMemoMgrList(); render(); await persistAndScheduleSync(); }
    }));
  }

  function parseNaturalLanguageWork(raw) {
    let text = String(raw || '').trim();
    if (!text) return null;
    const now = new Date();
    let targetDate = fmtDate(anchorDate);

    // 1) Parse explicit full year-month-day first (e.g. 2026年11月28日 / 2026-11-28 / 2026/11/28)
    const fullDateM = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
    if (fullDateM) {
      targetDate = `${fullDateM[1]}-${pad2(Number(fullDateM[2]))}-${pad2(Number(fullDateM[3]))}`;
      text = text.replace(fullDateM[0], ' ');
    } else if (/今天|今日/.test(text)) {
      targetDate = fmtDate(now);
      text = text.replace(/今天|今日/g, ' ');
    } else if (/明天|明日/.test(text)) {
      targetDate = fmtDate(addDays(now, 1));
      text = text.replace(/明天|明日/g, ' ');
    } else if (/大后天/.test(text)) {
      targetDate = fmtDate(addDays(now, 3));
      text = text.replace(/大后天/g, ' ');
    } else if (/后天/.test(text)) {
      targetDate = fmtDate(addDays(now, 2));
      text = text.replace(/后天/g, ' ');
    } else {
      const dateMatch = text.match(/(\d{1,2})[月/-](\d{1,2})日?/);
      if (dateMatch) {
        targetDate = `${now.getFullYear()}-${pad2(Number(dateMatch[1]))}-${pad2(Number(dateMatch[2]))}`;
        text = text.replace(dateMatch[0], ' ');
      }
      const wdMatch = text.match(/(下)?(?:星期|周)([一二三四五六日天])/);
      if (wdMatch) {
        const wdMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
        const mon = getMondayOf(anchorDate);
        const offsetDays = (wdMatch[1] ? 7 : 0) + (wdMap[wdMatch[2]] - 1);
        if (!dateMatch) targetDate = fmtDate(addDays(mon, offsetDays));
        text = text.replace(wdMatch[0], ' ');
      }
    }

    // 2) Parse time range or single clock expression
    let start = '09:00', end = '10:00';
    const rangeM = text.match(/(上午|早上|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})[:：.](\d{2})\s*[-~—到至]\s*(上午|早上|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})[:：.](\d{2})/);
    if (rangeM) {
      let sh = Number(rangeM[2]), eh = Number(rangeM[5]);
      if ((rangeM[1] === '下午' || rangeM[1] === '傍晚' || rangeM[1] === '晚上') && sh < 12) sh += 12;
      const ap2 = rangeM[4] || rangeM[1];
      if ((ap2 === '下午' || ap2 === '傍晚' || ap2 === '晚上') && eh < 12) eh += 12;
      start = `${pad2(sh)}:${rangeM[3]}`;
      end = `${pad2(eh)}:${rangeM[6]}`;
      text = text.replace(rangeM[0], ' ');
    } else {
      const cnTimeM = text.match(/(上午|早上|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})[点时](?:(\d{1,2})分?|半)?\s*(?:[-~—到至]\s*(上午|早上|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})[点时](?:(\d{1,2})分?|半)?)?/);
      if (cnTimeM) {
        const to24 = (ap, hStr, mStr, isHalf) => {
          let h = Number(hStr);
          if ((ap === '下午' || ap === '傍晚' || ap === '晚上') && h < 12) h += 12;
          const m = isHalf ? 30 : (mStr ? Number(mStr) : 0);
          return h * 60 + m;
        };
        const parts = cnTimeM[0].split(/[-~—到至]/);
        const head = parts[0] || '';
        const tail = parts[1] || '';
        const sM = to24(cnTimeM[1], cnTimeM[2], cnTimeM[3], /[点时]半/.test(head));
        start = fromMin(sM);
        if (cnTimeM[5]) {
          const ap2 = cnTimeM[4] || cnTimeM[1];
          const eM = to24(ap2, cnTimeM[5], cnTimeM[6], /[点时]半/.test(tail));
          end = fromMin(Math.max(sM + 15, eM));
        } else {
          end = fromMin(sM + 60);
        }
        text = text.replace(cnTimeM[0], ' ');
      } else {
        const singleHM = text.match(/(上午|早上|中午|下午|傍晚|晚上)?\s*(\d{1,2})[:：](\d{2})/);
        if (singleHM) {
          let sh = Number(singleHM[2]);
          if ((singleHM[1] === '下午' || singleHM[1] === '傍晚' || singleHM[1] === '晚上') && sh < 12) sh += 12;
          const sM = sh * 60 + Number(singleHM[3]);
          start = fromMin(sM);
          end = fromMin(sM + 60);
          text = text.replace(singleHM[0], ' ');
        }
      }
    }

    const urgent = /重要|紧急|加急|务必/.test(text);
    const title = text
      .replace(/【?通知】?[:：]?|各位老师好?[，,：:]?|请于|请在|按时|准时|收到请回复|重要|紧急|加急|务必/g, ' ')
      .replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim() || '临时工作事项';
    return { date: targetDate, start, end, title, urgent };
  }

  function generateWeeklyReportText() {
    const mon = getMondayOf(anchorDate);
    const sun = addDays(mon, 6);
    const wkNo = getWeekNumber(fmtDate(mon));
    const lines = [];
    lines.push(`【第 ${wkNo > 0 ? wkNo : '本'} 教学周工作周报】（${fmtDate(mon)} ~ ${fmtDate(sun)}）`);
    lines.push('');

    let totalCourses = 0;
    let movedCount = 0;
    const dailyCourseSummary = [];
    for (let i = 0; i < 7; i++) {
      const ds = fmtDate(addDays(mon, i));
      const { activeList } = getEffectiveCoursesForDate(ds, 'my');
      if (activeList.length) {
        totalCourses += activeList.length;
        movedCount += activeList.filter(c => c.isMoved).length;
        dailyCourseSummary.push(`  · ${WEEKDAYS_ISO[i + 1]}（${ds.slice(5)}）：${activeList.map(c => `${c.start} ${c.title}${c.isMoved ? '[调]' : ''}`).join('、')}`);
      }
    }
    lines.push(`一、本周授课与课务情况（共 ${totalCourses} 节${movedCount ? `，含单次调课 ${movedCount} 节` : ''}）`);
    if (dailyCourseSummary.length) lines.push(...dailyCourseSummary);
    else lines.push('  · 本周暂无个人排课记录');

    const startStr = fmtDate(mon), endStr = fmtDate(sun);
    const weekWorks = (appState.data.works || []).filter(w => !w.deleted && w.date >= startStr && w.date <= endStr)
      .sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start));
    const doneWorks = weekWorks.filter(w => w.done);
    const todoWorks = weekWorks.filter(w => !w.done);

    lines.push('');
    lines.push(`二、本周已完成事务（${doneWorks.length} 项）`);
    if (doneWorks.length) doneWorks.forEach((w, idx) => lines.push(`  ${idx + 1}. [${w.date.slice(5)} ${w.start}] ${w.title}${w.note ? '（' + w.note + '）' : ''}`));
    else lines.push('  · 暂无已勾选完成项');

    lines.push('');
    lines.push(`三、本周待办与下周衔接（${todoWorks.length} 项）`);
    if (todoWorks.length) todoWorks.forEach((w, idx) => lines.push(`  ${idx + 1}. [${w.date.slice(5)} ${w.start}] ${w.title}${w.urgent ? ' [重要]' : ''}`));
    else lines.push('  · 本周待办已全部清零');

    return lines.join('\n');
  }

  function exportAllJsonBackup() {
    const blob = new Blob([JSON.stringify(appState.data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `双图层日历备份_${fmtDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出完整日历备份（.json）');
  }

  // ===== 双击最左侧时间轴：智能批量排作息时间（支持 AI 自然语言描述） =====
  let bellBatchDraft = [];
  let bellCustomGaps = {};
  let bellEvDur = null;
  let bellEvBreak = null;

  function cnNumToInt(s) {
    const m = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (m[s]) return m[s];
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function parseCnClockToMin(seg, defaultAp = '') {
    if (!seg) return null;
    const m = String(seg).match(/(早上|早晨|上午|中午|下午|晚上|晚)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{2})|[点时]\s*(?:(\d{1,2})分?|半)?)/);
    if (!m) return null;
    const ap = m[1] || defaultAp;
    let h = Number(m[2]);
    if ((ap === '下午' || ap === '晚上' || ap === '晚') && h < 12) h += 12;
    if (ap === '中午' && h < 11) h += 12;
    let min = 0;
    if (m[3] !== undefined) min = Number(m[3]);
    else if (m[0].includes('半')) min = 30;
    else if (m[4] !== undefined) min = Number(m[4]);
    return h * 60 + min;
  }

  function extractDirectPeriodsFromText(txt) {
    const lines = String(txt || '').replace(/\r/g, '').split('\n');
    const rangeRe = /(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—–－至到]+\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
    const extracted = [];
    let pendingLabel = '';
    let isPmHint = false;
    let isEvHint = false;
    let lastStartMin = 0;

    for (const rawLine of lines) {
      const line = rawLine.replace(/["""]/g, '').replace(/\t+/g, ' ').trim();
      if (!line) continue;
      if (/下午|午后|午休|中\s*餐|午\s*餐/.test(line)) { isPmHint = true; isEvHint = false; }
      if (/晚上|晚自习|晚读/.test(line)) { isEvHint = true; isPmHint = false; }
      if (/早上|上午|早晨|早读/.test(line)) { isPmHint = false; isEvHint = false; }

      const rm = line.match(rangeRe);
      if (!rm) {
        if (/\d{1,2}\s*[:：]\s*\d{2}/.test(line)) pendingLabel = '';
        else if (line.length <= 28) pendingLabel = line;
        continue;
      }

      const inlineExtra = line.replace(rm[0], ' ').replace(/^[\s（(【［:：,，;；]+|[\s）)】］:：,，;；]+$/g, '').trim();
      const rowLabel = inlineExtra || pendingLabel || '';
      pendingLabel = '';

      let sh = Number(rm[1]), sm = Number(rm[2]), eh = Number(rm[3]), em = Number(rm[4]);
      if ((isEvHint || /晚/.test(rowLabel)) && sh >= 1 && sh <= 11) {
        sh += 12;
        if (eh >= 1 && eh <= 11) eh += 12;
      } else if ((isPmHint || lastStartMin >= 660) && sh >= 1 && sh <= 7) {
        sh += 12;
        if (eh >= 1 && eh <= 7) eh += 12;
      }
      if (eh < sh) eh += 12;

      const sMin = sh * 60 + sm;
      const eMin = eh * 60 + em;
      const dur = eMin - sMin;
      if (dur <= 0 || dur > 240) continue;

      const isTeachingKw = /(第?\s*[一二三四五六七八九十\d]{1,2}\s*节|早读|早自习|晚读|晚自习|自习|辅导)/.test(rowLabel);
      const isSkipKw = /(眼操|眼保健操|课间|大课间|小课间|跑操|广播操|早操|体锻|阳光体育|升旗|晨会|中\s*餐|午\s*餐|午\s*饭|早\s*餐|早\s*饭|午\s*休|午\s*睡|晚\s*餐|晚\s*饭|就餐|吃饭|放学|离校|静校|休息|预备)/.test(rowLabel);
      if (isSkipKw && !isTeachingKw) {
        lastStartMin = Math.max(lastStartMin, sMin);
        continue;
      }
      if (dur < 15 && !isTeachingKw) {
        lastStartMin = Math.max(lastStartMin, sMin);
        continue;
      }

      lastStartMin = Math.max(lastStartMin, sMin);
      let label = '';
      const secM = rowLabel.match(/第?\s*([一二三四五六七八九十\d]{1,2})\s*节/);
      if (/早读|早自习/.test(rowLabel)) label = '早读';
      else if (/晚自习/.test(rowLabel)) label = rowLabel.replace(/\s+/g, '');
      else if (secM) label = `第${cnNumToInt(secM[1])}节`;
      else label = rowLabel ? rowLabel.slice(0, 8) : '';

      extracted.push({ label, start: fromMin(sMin), end: fromMin(eMin), sMin, eMin });
    }

    const uniq = [];
    const seen = new Set();
    extracted.sort((a, b) => a.sMin - b.sMin).forEach((p) => {
      const key = `${p.start}-${p.end}`;
      if (seen.has(key)) return;
      seen.add(key);
      const fallbackLabel = p.sMin >= 1080 ? `晚自习${uniq.filter(x => x.sMin >= 1080).length + 1}` : `第${uniq.length + 1}节`;
      uniq.push({ num: uniq.length + 1, label: p.label || fallbackLabel, start: p.start, end: p.end, sMin: p.sMin, eMin: p.eMin });
    });
    return uniq;
  }

  function parseBellScheduleText(raw) {
    const txt = String(raw || '').trim();
    if (!txt) return null;

    // 优先提取直接粘贴的多行 Excel/Word 作息时间表
    const direct = extractDirectPeriodsFromText(txt);
    if (direct.length >= 2) {
      const am = direct.filter(p => p.sMin < 750);
      const pm = direct.filter(p => p.sMin >= 750 && p.sMin < 1080);
      const ev = direct.filter(p => p.sMin >= 1080);
      const durs = direct.map(p => p.eMin - p.sMin);
      const avgDur = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
      const smallGaps = [];
      for (let i = 0; i < direct.length - 1; i++) {
        const g = direct[i + 1].sMin - direct[i].eMin;
        if (g >= 0 && g <= 25) smallGaps.push(g);
      }
      return {
        directPeriods: direct.map(({ num, label, start, end }) => ({ num, label, start, end })),
        customGaps: {},
        classDur: avgDur,
        breakDur: smallGaps.length ? smallGaps[0] : 10,
        amStart: am.length ? am[0].start : undefined,
        amCount: am.length,
        pmStart: pm.length ? pm[0].start : undefined,
        pmCount: pm.length,
        evStart: ev.length ? ev[0].start : undefined,
        evCount: ev.length,
        notes: [`已直接提取 ${direct.length} 个上课节次（${direct[0].start}~${direct[direct.length - 1].end}）`],
      };
    }

    const res = { customGaps: {}, notes: [] };

    const durM = txt.match(/每节(?:课)?(?:时长)?\s*(\d{2,3})\s*分|(\d{2,3})\s*分钟?\s*(?:一|每)节/);
    if (durM) { res.classDur = Number(durM[1] || durM[2]); res.notes.push(`每节${res.classDur}分`); }

    const pairRe = /第?\s*([一二三四五六七八九十\d]{1,2})\s*节?\s*(?:和|与|跟|到|、)\s*第?\s*([一二三四五六七八九十\d]{1,2})\s*节?(?:之间)?[^，。；\n]*?(?:大课间|课间|休息|休)\s*(\d{1,3})\s*分/g;
    let pm;
    while ((pm = pairRe.exec(txt)) !== null) {
      const p1 = cnNumToInt(pm[1]), gap = Number(pm[3]);
      if (p1 >= 1 && p1 <= 12 && gap >= 0) {
        res.customGaps[p1] = gap;
        res.notes.push(`第${p1}-${p1 + 1}节间休${gap}分`);
      }
    }
    const afterRe = /第\s*([一二三四五六七八九十\d]{1,2})\s*节(?:后|下课后)[^，。；\n]*?(?:大课间|休息|休)\s*(\d{1,3})\s*分/g;
    let am;
    while ((am = afterRe.exec(txt)) !== null) {
      const p1 = cnNumToInt(am[1]), gap = Number(am[2]);
      if (p1 >= 1 && p1 <= 12 && gap >= 0 && res.customGaps[p1] === undefined) {
        res.customGaps[p1] = gap;
        res.notes.push(`第${p1}节后休${gap}分`);
      }
    }

    const brkM = txt.match(/(?:常规|普通|一般)?课间(?:休息)?\s*(\d{1,2})\s*分/);
    if (brkM) { res.breakDur = Number(brkM[1]); res.notes.push(`常规课间${res.breakDur}分`); }

    const amSeg = txt.match(/(?:早上|早晨|上午)[^，。；\n]*/);
    if (amSeg) {
      const tMin = parseCnClockToMin(amSeg[0], '上午');
      if (tMin !== null) { res.amStart = fromMin(tMin); res.notes.push(`上午${res.amStart}起`); }
      const cM = amSeg[0].match(/([一二三四五六\d])\s*节/);
      if (cM) res.amCount = cnNumToInt(cM[1]);
    }

    const pmSeg = txt.match(/下午[^，。；\n]*/);
    if (pmSeg) {
      const tMin = parseCnClockToMin(pmSeg[0], '下午');
      if (tMin !== null) { res.pmStart = fromMin(tMin); res.notes.push(`下午${res.pmStart}起`); }
      const cM = pmSeg[0].match(/([一二三四五六\d])\s*节/);
      if (cM) res.pmCount = cnNumToInt(cM[1]);
    }

    const evSeg = txt.match(/(?:晚上|晚自习)[^。；\n]*?(?=(?:早上|早晨|上午|下午)|$)/);
    if (evSeg) {
      const sTxt = evSeg[0];
      const rangeM = sTxt.match(/(\d{1,2}(?:[:：]\d{2}|[点时](?:\d{1,2}分?|半)?))\s*(?:到|至|-|~|—)\s*(\d{1,2}(?:[:：]\d{2}|[点时](?:\d{1,2}分?|半)?))/);
      const evBrkM = sTxt.match(/(?:中间|每节之间|课间|休息|休)\s*(\d{1,2})\s*分/);
      if (evBrkM) { res.evBreak = Number(evBrkM[1]); res.notes.push(`晚自习间休${res.evBreak}分`); }
      const evCntM = sTxt.match(/(?:共|上)?\s*([一二三四\d])\s*节/);
      if (evCntM) res.evCount = cnNumToInt(evCntM[1]);
      const evDurM = sTxt.match(/每节\s*(\d{2})\s*分/);
      if (evDurM) res.evDur = Number(evDurM[1]);

      if (rangeM) {
        const eStart = parseCnClockToMin(rangeM[1], '晚上');
        const eEnd = parseCnClockToMin(rangeM[2], '晚上');
        if (eStart !== null && eEnd !== null && eEnd > eStart) {
          res.evStart = fromMin(eStart);
          const total = eEnd - eStart;
          const eb = res.evBreak ?? 10;
          if (!res.evCount) {
            const targetPer = res.evDur || ((res.classDur || Number(document.getElementById('bb-class-dur').value) || 40) + 5);
            res.evCount = Math.max(1, Math.min(4, Math.round((total + eb) / (targetPer + eb))));
          }
          if (!res.evDur && res.evCount > 0) {
            res.evDur = Math.max(20, Math.round((total - eb * (res.evCount - 1)) / res.evCount));
          }
          res.notes.push(`晚自习${res.evStart}-${fromMin(eEnd)}(${res.evCount}节)`);
        }
      } else {
        const eStart = parseCnClockToMin(sTxt, '晚上');
        if (eStart !== null) { res.evStart = fromMin(eStart); res.notes.push(`晚自习${res.evStart}起`); }
      }
    }
    return res;
  }

  function formatGapDuration(mins) {
    if (mins <= 0) return '紧接下节';
    if (mins >= 60) {
      const h = Math.floor(mins / 60), m = mins % 60;
      return m ? `${h}小时${m}分` : `${h}小时`;
    }
    return `${mins}分钟`;
  }

  function openBellBatchModal() {
    bellCustomGaps = {}; bellEvDur = null; bellEvBreak = null;
    const sumEl = document.getElementById('bb-ai-summary');
    if (sumEl) sumEl.classList.add('hidden');
    const cur = getPeriods().slice().sort((a, b) => toMin(a.start) - toMin(b.start));
    const am = cur.filter(p => toMin(p.start) < 12 * 60);
    const pm = cur.filter(p => toMin(p.start) >= 12 * 60 && toMin(p.start) < 18 * 60);
    const ev = cur.filter(p => toMin(p.start) >= 18 * 60);

    const sampleDur = am.length ? Math.max(15, toMin(am[0].end) - toMin(am[0].start)) : 40;
    let normalBreak = 15;
    if (am.length >= 2) {
      normalBreak = Math.max(0, toMin(am[1].start) - toMin(am[0].end));
    }

    document.getElementById('bb-class-dur').value = sampleDur;
    document.getElementById('bb-break-dur').value = normalBreak;
    document.getElementById('bb-am-start').value = am.length ? am[0].start : '08:00';
    document.getElementById('bb-am-count').value = am.length || 4;
    document.getElementById('bb-pm-start').value = pm.length ? pm[0].start : '13:30';
    document.getElementById('bb-pm-count').value = pm.length || 4;
    document.getElementById('bb-ev-start').value = ev.length ? ev[0].start : '18:30';
    document.getElementById('bb-ev-count').value = ev.length || 3;

    // 探测现有大课间
    let bigAfter = 0, bigDur = 25;
    for (let i = 0; i < am.length - 1; i++) {
      const g = toMin(am[i + 1].start) - toMin(am[i].end);
      if (g >= normalBreak + 8) { bigAfter = i + 1; bigDur = g; break; }
    }
    document.getElementById('bb-big-after').value = String(bigAfter);
    document.getElementById('bb-big-dur').value = bigDur;

    recalcBellBatchDraft();
    openModal('modal-bell-batch');
  }

  function recalcBellBatchDraft() {
    const classDur = Math.max(15, Math.min(90, Number(document.getElementById('bb-class-dur').value) || 40));
    const breakDur = Math.max(0, Math.min(60, Number(document.getElementById('bb-break-dur').value) || 10));
    const bigAfter = Number(document.getElementById('bb-big-after').value) || 0;
    const bigDur = Math.max(5, Math.min(60, Number(document.getElementById('bb-big-dur').value) || 25));

    const amStart = toMin(document.getElementById('bb-am-start').value || '08:00');
    const amCount = Math.max(1, Math.min(6, Number(document.getElementById('bb-am-count').value) || 4));
    const pmStart = toMin(document.getElementById('bb-pm-start').value || '13:30');
    const pmCount = Math.max(0, Math.min(6, Number(document.getElementById('bb-pm-count').value) || 0));
    const evStart = toMin(document.getElementById('bb-ev-start').value || '18:30');
    const evCount = Math.max(0, Math.min(4, Number(document.getElementById('bb-ev-count').value) || 0));

    const list = [];
    let cursor = amStart;
    for (let i = 1; i <= amCount; i++) {
      const s = cursor, e = s + classDur;
      list.push({ num: list.length + 1, label: `第${i}节`, start: fromMin(s), end: fromMin(e) });
      const g = bellCustomGaps[i] !== undefined ? bellCustomGaps[i] : (i === bigAfter ? bigDur : breakDur);
      cursor = e + g;
    }

    const amLastEnd = list.length ? toMin(list[list.length - 1].end) : amStart;
    const noonGap = Math.max(0, pmStart - amLastEnd);
    document.getElementById('bell-noon-badge').textContent = pmCount > 0
      ? `🍱 中午休息：${formatGapDuration(noonGap)}（${fromMin(amLastEnd)} → ${fromMin(pmStart)}）`
      : '无下午课程';

    cursor = pmStart;
    for (let i = 1; i <= pmCount; i++) {
      const idx = amCount + i;
      const s = cursor, e = s + classDur;
      list.push({ num: list.length + 1, label: `第${idx}节`, start: fromMin(s), end: fromMin(e) });
      const g = bellCustomGaps[idx] !== undefined ? bellCustomGaps[idx] : breakDur;
      cursor = e + g;
    }

    const evDur = bellEvDur || Math.max(30, Math.min(60, classDur + 5));
    const evBrk = bellEvBreak !== null ? bellEvBreak : 10;
    cursor = evStart;
    for (let i = 1; i <= evCount; i++) {
      const s = cursor, e = s + evDur;
      list.push({ num: list.length + 1, label: `晚自习${i}`, start: fromMin(s), end: fromMin(e) });
      cursor = e + evBrk;
    }

    bellBatchDraft = list;
    renderBellBatchPreview();
  }

  function renderBellBatchPreview() {
    const container = document.getElementById('bb-preview-list');
    container.innerHTML = bellBatchDraft.map((p, idx) => {
      let gapLabel = '当日最后一节';
      if (idx < bellBatchDraft.length - 1) {
        const next = bellBatchDraft[idx + 1];
        const gap = toMin(next.start) - toMin(p.end);
        const curEndH = toMin(p.end) / 60;
        if (curEndH <= 12.5 && toMin(next.start) >= 12.5 * 60) {
          gapLabel = `🍱 午休 ${formatGapDuration(gap)}`;
        } else if (curEndH < 18 && toMin(next.start) >= 18 * 60) {
          gapLabel = `🌆 晚读 ${formatGapDuration(gap)}`;
        } else if (gap >= 20) {
          gapLabel = `🏃 大课间 ${formatGapDuration(gap)}`;
        } else {
          gapLabel = `课间 ${formatGapDuration(gap)}`;
        }
      }
      return `
        <div class="bell-preview-row">
          <strong style="color:var(--text-main);">${escapeHtml(p.label)}</strong>
          <input type="time" class="input" style="padding:3px 7px;font-size:12px;" value="${p.start}" data-bb-edit="start" data-bb-idx="${idx}" />
          <span style="text-align:center;color:var(--text-muted);">-</span>
          <input type="time" class="input" style="padding:3px 7px;font-size:12px;" value="${p.end}" data-bb-edit="end" data-bb-idx="${idx}" />
          <span class="bell-gap-tag">${gapLabel}</span>
        </div>`;
    }).join('');

    container.querySelectorAll('[data-bb-edit]').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = Number(inp.dataset.bbIdx);
        bellBatchDraft[i][inp.dataset.bbEdit] = inp.value;
        renderBellBatchPreview();
      });
    });
  }

  function remapCoursesByPeriods(courses, oldPeriods, newPeriods, now) {
    if (!oldPeriods.length || !newPeriods.length) return;
    courses.forEach(c => {
      if (c.deleted) return;
      const mid = (toMin(c.start) + toMin(c.end)) / 2;
      let bestIdx = 0, bestDist = Infinity;
      oldPeriods.forEach((op, idx) => {
        const d = Math.abs(mid - (toMin(op.start) + toMin(op.end)) / 2);
        if (d < bestDist) { bestDist = d; bestIdx = idx; }
      });
      if (bestDist <= 30 && newPeriods[bestIdx]) {
        c.start = newPeriods[bestIdx].start;
        c.end = newPeriods[bestIdx].end;
        c.updatedAt = now;
      }
    });
  }

  function openSmartImportModal(target = 'class') {
    activeImportTarget = target;
    const activeCls = getActiveClassTt();
    const className = activeCls?.className || '902班';
    document.getElementById('si-modal-title').textContent = target === 'class'
      ? `✨ 智能导入「${className}」班级课表（三合一）`
      : '✨ 智能导入个人授课课表（三合一）';
    document.getElementById('si-result-box').classList.add('hidden');
    openModal('modal-smart-import');
  }

  async function executeSmartImport(kind = 'auto') {
    const resBox = document.getElementById('si-result-box');
    if (kind === 'image') {
      resBox.className = 'hint-box';
      resBox.textContent = '📷 正在运行本地中文 OCR 识别课表并分析时间列，请稍候…';
      resBox.classList.remove('hidden');
    }
    const res = await window.SyncBridge.importSchedule({ target: activeImportTarget, kind });
    if (!res || res.canceled) {
      if (kind === 'image') resBox.classList.add('hidden');
      return;
    }
    if (!res.ok) {
      resBox.className = 'warn-box';
      resBox.textContent = res.message || '识别导入失败';
      resBox.classList.remove('hidden');
      showToast(res.message || '导入失败');
      return;
    }

    const now = Date.now();
    const activeCls = activeImportTarget === 'class' ? getActiveClassTt() : null;
    const targetArr = activeImportTarget === 'class'
      ? activeCls.courses
      : appState.data.timetable.courses;

    // 软删除旧课表并写入自动分配好的新课表
    targetArr.forEach(c => { c.deleted = true; c.updatedAt = now; });
    targetArr.push(...res.courses);
    if (activeCls) {
      activeCls.metaUpdatedAt = now;
      syncLegacyClassTimetableMirror();
    } else if (appState.data.timetable) {
      appState.data.timetable.metaUpdatedAt = now;
    }

    // 自动识别时间并同步调整最左侧时间轴与磁吸节次表
    const autoAdjust = document.getElementById('si-auto-adjust-time').checked;
    let timeAdjustTip = '';
    if (autoAdjust && Array.isArray(res.detectedPeriods) && res.detectedPeriods.length) {
      appState.data.timetable.periods = res.detectedPeriods;
      appState.data.timetable.metaUpdatedAt = now;
      if (typeof res.minStartMin === 'number') {
        appState.config.ui.timeStartHour = Math.max(6, Math.floor((res.minStartMin - 20) / 30) / 2);
      }
      if (res.hasEvening) appState.config.ui.showEvening = true;
      if (res.hasWeekend) appState.config.ui.showWeekend = true;
      const firstP = res.detectedPeriods[0];
      const lastP = res.detectedPeriods[res.detectedPeriods.length - 1];
      timeAdjustTip = `<br/>⏱ 已自动识别 <strong>${res.detectedPeriods.length} 个节次</strong>（${firstP.start} ~ ${lastP.end}），并已同步调整最左侧时间轴与磁吸槽位！`;
    }

    const formatName = { grid: '网格课表', list: '清单课表', 'image-ocr': '拍照/截图 OCR' }[res.format] || '课表文件';
    resBox.className = 'hint-box';
    resBox.innerHTML = `✅ <strong>识别并分配成功！</strong>（来源：${formatName}，共编排 <strong>${res.courses.length} 节课</strong>到对应星期）${timeAdjustTip}`;
    resBox.classList.remove('hidden');

    if (!document.getElementById('modal-timetable').classList.contains('hidden')) {
      renderTimetableManager();
    }
    render();
    await persistAndScheduleSync();
    showToast(`已自动识别并编排 ${res.courses.length} 节课`);
  }

  function openModal(id) {
    const bd = document.getElementById(id);
    if (!bd) return;
    const box = bd.querySelector('.modal');
    if (box) { box.style.transform = ''; box.dataset.dragOx = '0'; box.dataset.dragOy = '0'; }
    bd.classList.remove('hidden');
  }
  function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

  // ===== 绑定所有事件 =====
  function bindGlobalEvents() {
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => { currentView = btn.dataset.view; render(); });
    });
    document.getElementById('btn-prev').addEventListener('click', () => {
      anchorDate = currentView === 'day' ? addDays(anchorDate, -1) : currentView === 'week' ? addDays(anchorDate, -7) : new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
      render();
    });
    document.getElementById('btn-next').addEventListener('click', () => {
      anchorDate = currentView === 'day' ? addDays(anchorDate, 1) : currentView === 'week' ? addDays(anchorDate, 7) : new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
      render();
    });
    let topDateClickTimer = null;
    const topFullDateEl = document.getElementById('topbar-full-date');
    topFullDateEl.addEventListener('click', () => {
      if (topDateClickTimer) clearTimeout(topDateClickTimer);
      topDateClickTimer = setTimeout(() => {
        topDateClickTimer = null;
        anchorDate = new Date();
        render();
        showToast('已回到今天（双击日期可打开中国农历与节假日日历）');
      }, 230);
    });

    let cnCalYear = anchorDate.getFullYear(), cnCalMonth = anchorDate.getMonth();
    function initCnCalSelects() {
      const ySel = document.getElementById('cncal-year');
      const mSel = document.getElementById('cncal-month');
      if (!ySel || !mSel || ySel.options.length) return;
      for (let y = 2024; y <= 2028; y++) ySel.add(new Option(`${y}年`, String(y)));
      for (let m = 0; m < 12; m++) mSel.add(new Option(`${m + 1}月`, String(m)));
      ySel.addEventListener('change', () => { cnCalYear = Number(ySel.value); renderCnCalendar(); });
      mSel.addEventListener('change', () => { cnCalMonth = Number(mSel.value); renderCnCalendar(); });
      document.getElementById('btn-cncal-prev').addEventListener('click', () => {
        cnCalMonth -= 1;
        if (cnCalMonth < 0) { cnCalMonth = 11; cnCalYear -= 1; }
        renderCnCalendar();
      });
      document.getElementById('btn-cncal-next').addEventListener('click', () => {
        cnCalMonth += 1;
        if (cnCalMonth > 11) { cnCalMonth = 0; cnCalYear += 1; }
        renderCnCalendar();
      });
      document.getElementById('btn-cncal-today').addEventListener('click', () => {
        const now = new Date();
        cnCalYear = now.getFullYear();
        cnCalMonth = now.getMonth();
        renderCnCalendar();
      });
    }
    function renderCnCalendar() {
      initCnCalSelects();
      document.getElementById('cncal-year').value = String(cnCalYear);
      document.getElementById('cncal-month').value = String(cnCalMonth);
      const first = new Date(cnCalYear, cnCalMonth, 1);
      const startOffset = (first.getDay() + 6) % 7;
      const gridStart = addDays(first, -startOffset);
      const todayStr = fmtDate(new Date());
      const gridEl = document.getElementById('cncal-grid');
      let html = '';
      for (let i = 0; i < 42; i++) {
        const d = addDays(gridStart, i);
        const meta = getCnCalendarMeta(d);
        const cls = ['cn-cell'];
        if (d.getMonth() !== cnCalMonth) cls.push('other-m');
        if (meta.ds === todayStr) cls.push('is-today');
        if (meta.tagType === 'rest') cls.push('is-holiday');
        else if (meta.tagType === 'work') cls.push('is-workday');
        else if (meta.isWeekend) cls.push('is-weekend');
        const badge = meta.tagType === 'rest'
          ? '<span class="cn-tag rest">休</span>'
          : (meta.tagType === 'work' ? '<span class="cn-tag work">班</span>' : '');
        const tip = `${meta.ds} ${getLunarParts(d)?.full || ''}${meta.festLabel ? ' · ' + meta.festLabel : ''}${meta.solarTerm ? ' · ' + meta.solarTerm : ''}${meta.yiji ? '\n' + meta.yiji : ''}`;
        const cnSubHtml = meta.solarTerm && meta.subText === meta.solarTerm
          ? `<span style="color:var(--solar-term-color);font-weight:700;">${escapeHtml(meta.subText)}</span>`
          : escapeHtml(meta.subText);
        html += `
          <div class="${cls.join(' ')}" data-cncal-jump="${meta.ds}" title="${escapeAttr(tip)}">
            ${badge}
            <div class="cn-solar">${d.getDate()}</div>
            <div class="cn-lunar ${meta.isFest ? 'is-fest' : ''}">${cnSubHtml}</div>
          </div>`;
      }
      gridEl.innerHTML = html;
      gridEl.querySelectorAll('[data-cncal-jump]').forEach(cell => cell.addEventListener('click', () => {
        anchorDate = parseDate(cell.dataset.cncalJump);
        closeModal('modal-cn-cal');
        render();
        showToast(`已跳转至 ${anchorDate.getFullYear()}年${anchorDate.getMonth() + 1}月${anchorDate.getDate()}日（${formatLunarText(anchorDate)}）`);
      }));
    }
    topFullDateEl.addEventListener('dblclick', () => {
      if (topDateClickTimer) { clearTimeout(topDateClickTimer); topDateClickTimer = null; }
      cnCalYear = anchorDate.getFullYear();
      cnCalMonth = anchorDate.getMonth();
      const calBox = document.querySelector('#modal-cn-cal .modal');
      if (calBox) { calBox.style.transform = ''; calBox.dataset.dragOx = '0'; calBox.dataset.dragOy = '0'; }
      renderCnCalendar();
      openModal('modal-cn-cal');
    });

    // 顶部极简图标区：统一齿轮菜单 + 独立坚果云同步与账户图标
    document.getElementById('btn-plugin-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdownMenu('menu-plugin', e.currentTarget);
    });
    document.getElementById('btn-cloud-icon').addEventListener('click', openSyncModal);
    const closeWinBtn = document.getElementById('btn-close-window');
    if (closeWinBtn) {
      closeWinBtn.addEventListener('click', async () => {
        if (window.SyncBridge.mode === 'desktop') {
          await window.SyncBridge.windowAction('hide');
        } else {
          showToast('界面已收纳（桌面端关闭仅隐藏到右下角托盘，右键托盘才算彻底退出）');
        }
      });
    }
    const autoLaunchEl = document.getElementById('opt-autolaunch');
    if (autoLaunchEl) {
      autoLaunchEl.addEventListener('change', async (e) => {
        const autoLaunch = !!e.target.checked;
        appState.config.ui.autoLaunch = autoLaunch;
        if (window.SyncBridge.mode === 'desktop') {
          await window.SyncBridge.setDesktopOptions({ autoLaunch });
        }
        await window.SyncBridge.saveState(appState);
        showToast(autoLaunch ? '🚀 已开启 Windows 开机自动启动' : '已关闭开机自动启动');
      });
    }
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-menu') && !e.target.closest('#btn-plugin-menu')) {
        closeAllMenus();
      }
    });

    // 图层栏右侧 AI 工作平台独立入口
    document.getElementById('btn-ai-bar').addEventListener('click', () => {
      document.getElementById('ai-parse-preview').classList.add('hidden');
      openModal('modal-ai-platform');
      setTimeout(() => document.getElementById('ai-nl-input')?.focus(), 40);
    });

    function togglePrivacyMask() {
      isPrivacyMasked = !isPrivacyMasked;
      document.body.classList.toggle('privacy-masked', isPrivacyMasked);
      const pf = document.getElementById('menu-privacy-flag');
      if (pf) pf.textContent = isPrivacyMasked ? '🔒' : '🔓';
      showToast(isPrivacyMasked ? '🔒 已开启隐私保护：日历内容已模糊隐藏' : '🔓 已恢复显示日历内容');
    }

    // ⚙ 统一菜单动作绑定（课表与待办 / 查找与数据 / 系统）
    document.querySelectorAll('[data-plugin-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.pluginAct;
        closeAllMenus();
        if (act === 'schedule-mgr') {
          activeTtTab = appState.config.ui.homeroomMode ? 'class' : 'my';
          editingTtCourseId = null;
          renderTimetableManager();
          openModal('modal-timetable');
        } else if (act === 'import') {
          openSmartImportModal(appState.config.ui.homeroomMode ? 'class' : 'my');
        } else if (act === 'new-memo') {
          if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
          openWorkModal(null);
        } else if (act === 'memo-mgr') {
          renderMemoMgrList();
          openModal('modal-memo-mgr');
        } else if (act === 'weekly-report') {
          document.getElementById('wr-content').value = generateWeeklyReportText();
          openModal('modal-weekly-report');
        } else if (act === 'search') {
          openSearchModal(false);
        } else if (act === 'sys-settings' || act === 'theme') {
          openSettingsModal('theme');
        } else if (act === 'privacy-mask') {
          togglePrivacyMask();
        } else if (act === 'export') {
          exportAllJsonBackup();
        } else if (act === 'print') {
          window.print();
        } else if (act === 'hide-window') {
          if (window.SyncBridge.mode === 'desktop') {
            await window.SyncBridge.windowAction('hide');
          } else {
            showToast('已隐藏到后台（右键托盘点击「彻底退出桌面日历」才会退出）');
          }
        }
      });
    });

    // 3 档主题切换：白天 / 黑夜 / 自动识别
    document.querySelectorAll('[data-theme-mode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        appState.config.ui.theme = btn.dataset.themeMode;
        if (appState.config.ui.skinColor) {
          appState.config.ui.skinColor = '';
          appState.config.ui.skinColorName = '默认';
        }
        render();
        await persistAndScheduleSync(false);
      });
    });
    if (darkMediaQuery && darkMediaQuery.addEventListener) {
      darkMediaQuery.addEventListener('change', () => {
        if (appState?.config?.ui?.theme === 'auto') render();
      });
    }

    // 纯色皮肤选择 + 自定义拾色器
    document.querySelectorAll('[data-skin-color]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hex = btn.dataset.skinColor || '';
        appState.config.ui.skinColor = hex;
        appState.config.ui.skinColorName = hex ? (btn.title || hex) : '默认';
        if (hex) appState.config.ui.bgAlpha = 98;
        else if ((appState.config.ui.bgAlpha ?? 72) >= 95) appState.config.ui.bgAlpha = 72;
        render();
        await persistAndScheduleSync(false);
      });
    });
    const customSkinInp = document.getElementById('inp-custom-skin');
    if (customSkinInp) {
      customSkinInp.addEventListener('input', async (e) => {
        appState.config.ui.skinColor = e.target.value;
        appState.config.ui.skinColorName = `自定义 ${e.target.value.toUpperCase()}`;
        if ((appState.config.ui.bgAlpha ?? 72) < 20) appState.config.ui.bgAlpha = 98;
        render();
        await persistAndScheduleSync(false);
      });
    }

    // 主题皮肤：透明 / 半透明预设快捷切换
    const bgStyleAlphaMap = { transparent: 6, translucent: 38, frosted: 72, solid: 96 };
    document.querySelectorAll('[data-bg-style]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const presetAlpha = bgStyleAlphaMap[btn.dataset.bgStyle];
        if (typeof presetAlpha !== 'number') return;
        appState.config.ui.bgAlpha = presetAlpha;
        render();
        await persistAndScheduleSync(false);
      });
    });

    const bgAlphaSlider = document.getElementById('rng-bg-alpha-set');
    if (bgAlphaSlider) {
      bgAlphaSlider.addEventListener('pointerdown', () => document.getElementById('modal-settings')?.classList.add('adjusting-alpha'));
    }
    window.addEventListener('pointerup', () => document.getElementById('modal-settings')?.classList.remove('adjusting-alpha'));

    // 互斥「班级课表」勾选逻辑 + 横幅内多班级新建/管理/导入按钮
    document.getElementById('chk-homeroom').addEventListener('change', (e) => setHomeroomMode(e.target.checked));
    document.getElementById('btn-exit-homeroom').addEventListener('click', () => setHomeroomMode(false));
    document.getElementById('btn-homeroom-smart-import').addEventListener('click', () => openSmartImportModal('class'));
    document.getElementById('btn-homeroom-add-cls')?.addEventListener('click', async () => {
      const nc = addNewClassTimetable();
      if (nc) {
        render();
        await persistAndScheduleSync(false);
        showToast(`已新增「${nc.className}」，可直接点击导入或管理录入该班课表`);
      }
    });
    document.getElementById('btn-homeroom-manage')?.addEventListener('click', () => {
      activeTtTab = 'class';
      editingTtCourseId = null;
      renderTimetableManager();
      openModal('modal-timetable');
    });

    // 独立开关：是否展示晚自习 & 是否展示周末
    document.getElementById('btn-toggle-evening').addEventListener('click', async () => {
      appState.config.ui.showEvening = !appState.config.ui.showEvening;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('btn-toggle-weekend').addEventListener('click', async () => {
      appState.config.ui.showWeekend = !appState.config.ui.showWeekend;
      render(); await persistAndScheduleSync(false);
    });

    // 若当前在班主任模式，点回「底层课表」或「顶层干活」时自动退出班主任模式
    document.getElementById('chk-show-course').addEventListener('change', async (e) => {
      if (appState.config.ui.homeroomMode) {
        appState.config.ui.homeroomMode = false;
        appState.config.ui.showCourse = true;
        appState.config.ui.showWork = savedPersonalLayers.showWork;
      } else {
        appState.config.ui.showCourse = e.target.checked;
      }
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('chk-show-work').addEventListener('change', async (e) => {
      if (appState.config.ui.homeroomMode) {
        appState.config.ui.homeroomMode = false;
        appState.config.ui.showWork = true;
        appState.config.ui.showCourse = savedPersonalLayers.showCourse;
      } else {
        appState.config.ui.showWork = e.target.checked;
      }
      render(); await persistAndScheduleSync(false);
    });

    const saveSimpleUi = async () => {
      appState.config.ui.magnetSnap = document.getElementById('chk-magnet').checked;
      appState.config.ui.courseOpacity = Number(document.getElementById('rng-course-opacity').value);
      appState.config.ui.workOpacity = Number(document.getElementById('rng-work-opacity').value);
      render(); await persistAndScheduleSync(false);
    };
    document.getElementById('chk-magnet').addEventListener('change', saveSimpleUi);
    ['rng-course-opacity', 'rng-work-opacity'].forEach(id => {
      document.getElementById(id).addEventListener('input', saveSimpleUi);
    });
    const bgAlphaSetEl = document.getElementById('rng-bg-alpha-set');
    if (bgAlphaSetEl) {
      bgAlphaSetEl.addEventListener('input', async (e) => {
        appState.config.ui.bgAlpha = Number(e.target.value);
        render(); await persistAndScheduleSync(false);
      });
    }

    // 搜索、便签管理、AI 排程、周报弹窗事件
    document.getElementById('srch-input').addEventListener('input', (e) => renderSearchResults(e.target.value));
    document.getElementById('btn-srch-jump').addEventListener('click', () => {
      const val = document.getElementById('srch-jump-date').value;
      if (val) { anchorDate = parseDate(val); closeModal('modal-search'); render(); }
    });

    document.querySelectorAll('[data-memo-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        memoMgrFilter = btn.dataset.memoFilter;
        document.querySelectorAll('[data-memo-filter]').forEach(b => b.classList.toggle('active', b.dataset.memoFilter === memoMgrFilter));
        renderMemoMgrList();
      });
    });
    document.getElementById('btn-memo-mgr-new').addEventListener('click', async () => {
      closeModal('modal-memo-mgr');
      if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
      openWorkModal(null);
    });
    document.getElementById('btn-memo-clear-done').addEventListener('click', async () => {
      const now = Date.now();
      let cnt = 0;
      (appState.data.works || []).forEach(w => { if (!w.deleted && w.done) { w.deleted = true; w.updatedAt = now; cnt++; } });
      renderMemoMgrList(); render(); await persistAndScheduleSync();
      showToast(cnt ? `已清理 ${cnt} 条已完成便签` : '没有可清理的已完成便签');
    });

    document.getElementById('btn-ai-parse-add').addEventListener('click', async () => {
      const raw = document.getElementById('ai-nl-input').value;
      const parsed = parseNaturalLanguageWork(raw);
      if (!parsed) { showToast('请先输入日程内容'); return; }
      const now = Date.now();
      appState.data.works.push({
        id: uid('w'), date: parsed.date, start: parsed.start, end: parsed.end,
        title: parsed.title, note: '由 AI 工作平台解析添加', urgent: parsed.urgent, done: false, updatedAt: now, deleted: false,
      });
      if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
      anchorDate = parseDate(parsed.date);
      const pv = document.getElementById('ai-parse-preview');
      pv.textContent = `✅ 已添加：${parsed.date} ${parsed.start}-${parsed.end} · ${parsed.title}`;
      pv.classList.remove('hidden');
      document.getElementById('ai-nl-input').value = '';
      render(); await persistAndScheduleSync();
      showToast('已解析并加入待办');
    });
    document.getElementById('btn-ai-to-report').addEventListener('click', () => {
      closeModal('modal-ai-platform');
      document.getElementById('wr-content').value = generateWeeklyReportText();
      openModal('modal-weekly-report');
    });

    document.getElementById('btn-wr-regen').addEventListener('click', () => {
      document.getElementById('wr-content').value = generateWeeklyReportText();
      showToast('已按最新日程重新汇总');
    });
    document.getElementById('btn-wr-copy').addEventListener('click', async () => {
      const txt = document.getElementById('wr-content').value;
      try { await navigator.clipboard.writeText(txt); showToast('📋 周报已复制到剪贴板'); }
      catch { document.getElementById('wr-content').select(); document.execCommand('copy'); showToast('📋 周报已复制'); }
    });
    document.getElementById('btn-open-bell-from-set').addEventListener('click', () => {
      closeModal('modal-settings');
      openBellBatchModal();
    });
    document.getElementById('btn-open-tt-from-set').addEventListener('click', () => {
      closeModal('modal-settings');
      activeTtTab = appState.config.ui.homeroomMode ? 'class' : 'my';
      renderTimetableManager();
      openModal('modal-timetable');
    });

    // 新增偏好设置绑定：毛玻璃、字体字号配色、周数/休息日/节气/黄历、待办规则与音效、全局快捷键与恢复默认
    document.getElementById('sw-frosted-blur')?.addEventListener('change', async (e) => {
      appState.config.ui.frostedBlur = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
      showToast(appState.config.ui.frostedBlur ? '🫧 已开启毛玻璃模糊特效' : '已关闭毛玻璃模糊特效');
    });
    document.getElementById('sel-font-family')?.addEventListener('change', async (e) => {
      appState.config.ui.fontFamily = e.target.value;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sel-font-scale')?.addEventListener('change', async (e) => {
      appState.config.ui.fontSize = Number(e.target.value) || 13;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('col-text-main')?.addEventListener('input', async (e) => {
      appState.config.ui.textMainColor = e.target.value;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('col-today-accent')?.addEventListener('input', async (e) => {
      appState.config.ui.todayAccent = e.target.value;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('col-rest-bg')?.addEventListener('input', async (e) => {
      appState.config.ui.restColBg = e.target.value;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('col-holiday-text')?.addEventListener('input', async (e) => {
      appState.config.ui.holidayColor = e.target.value;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('col-term-text')?.addEventListener('input', async (e) => {
      appState.config.ui.solarTermColor = e.target.value;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('btn-reset-colors')?.addEventListener('click', async () => {
      Object.assign(appState.config.ui, {
        textMainColor: '',
        todayAccent: DEFAULT_UI_PREFS.todayAccent,
        restColBg: '',
        holidayColor: DEFAULT_UI_PREFS.holidayColor,
        solarTermColor: DEFAULT_UI_PREFS.solarTermColor,
      });
      render(); await persistAndScheduleSync(false);
      showToast('已还原全部默认字体与重点配色');
    });

    document.getElementById('sw-show-weeknum')?.addEventListener('change', async (e) => {
      appState.config.ui.showWeekNum = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-show-rest')?.addEventListener('change', async (e) => {
      appState.config.ui.showWeekend = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.querySelectorAll('[data-rest-wd]').forEach(chk => chk.addEventListener('change', async () => {
      appState.config.ui.restWeekdays = Array.from(document.querySelectorAll('[data-rest-wd]:checked')).map(x => Number(x.dataset.restWd));
      render(); await persistAndScheduleSync(false);
    }));
    document.getElementById('sw-show-stat')?.addEventListener('change', async (e) => {
      appState.config.ui.showStatutory = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-show-fest')?.addEventListener('change', async (e) => {
      appState.config.ui.showFestival = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-show-lunar')?.addEventListener('change', async (e) => {
      appState.config.ui.showLunar = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-show-solarterm')?.addEventListener('change', async (e) => {
      appState.config.ui.showSolarTerm = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-show-yiji')?.addEventListener('change', async (e) => {
      appState.config.ui.showYiJi = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
      showToast(appState.config.ui.showYiJi ? '💡 悬停日期表头、月历或农历格即可查看今日宜忌' : '已关闭黄历忌宜提示');
    });

    document.querySelectorAll('[data-bullet-style]').forEach(btn => btn.addEventListener('click', async () => {
      appState.config.ui.bulletStyle = btn.dataset.bulletStyle;
      render(); await persistAndScheduleSync(false);
    }));
    document.getElementById('sw-show-done-work')?.addEventListener('change', async (e) => {
      appState.config.ui.showDoneWork = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-done-bottom')?.addEventListener('change', async (e) => {
      appState.config.ui.doneToBottom = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
    });
    document.getElementById('sw-auto-rollover')?.addEventListener('change', async (e) => {
      appState.config.ui.autoRollover = !!e.target.checked;
      render(); await persistAndScheduleSync(false);
      showToast(appState.config.ui.autoRollover ? '↪ 已开启：未完成待办 30 天内自动顺延至今天' : '已关闭跨日自动顺延');
    });
    document.getElementById('sel-done-sound')?.addEventListener('change', async (e) => {
      appState.config.ui.doneSound = e.target.value;
      if (e.target.value !== 'none') playSoundEffect(e.target.value);
      await persistAndScheduleSync(false);
    });
    document.getElementById('sel-rem-sound')?.addEventListener('change', async (e) => {
      appState.config.ui.remSound = e.target.value;
      await persistAndScheduleSync(false);
    });
    document.getElementById('btn-preview-sound')?.addEventListener('click', () => {
      playSoundEffect(appState?.config?.ui?.remSound || 'chime');
    });

    const hotkeyBindings = [
      ['hk-hide-key', 'sw-hk-hide', 'hide'],
      ['hk-priv-key', 'sw-hk-priv', 'priv'],
      ['hk-lock-key', 'sw-hk-lock', 'lock'],
      ['hk-memo-key', 'sw-hk-memo', 'memo'],
    ];
    function formatShortcutEv(ev) {
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) return '';
      const parts = [];
      if (ev.ctrlKey) parts.push('Ctrl');
      if (ev.altKey) parts.push('Alt');
      if (ev.shiftKey) parts.push('Shift');
      const k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
      if (!parts.length) return '';
      parts.push(k);
      return parts.join('+');
    }
    hotkeyBindings.forEach(([inpId, swId, hkKey]) => {
      const inp = document.getElementById(inpId);
      const sw = document.getElementById(swId);
      if (inp) {
        inp.addEventListener('focus', () => { window.SyncBridge.windowAction('suspend-hotkeys'); });
        inp.addEventListener('blur', () => { window.SyncBridge.windowAction('resume-hotkeys'); });
        inp.addEventListener('keydown', async (e) => {
          e.preventDefault();
          const combo = formatShortcutEv(e);
          if (!combo) { showToast('请至少配合 Ctrl / Alt / Shift 组合按键'); return; }
          ensureUiPrefs().hotkeys[hkKey].key = combo;
          render();
          await persistAndScheduleSync(false);
          showToast(`⌨ 已将快捷键修改为 ${combo}`);
        });
      }
      if (sw) {
        sw.addEventListener('change', async (e) => {
          ensureUiPrefs().hotkeys[hkKey].enabled = !!e.target.checked;
          await persistAndScheduleSync(false);
        });
      }
    });

    document.getElementById('btn-reset-defaults')?.addEventListener('click', async () => {
      const defCopy = JSON.parse(JSON.stringify(DEFAULT_UI_PREFS));
      Object.assign(appState.config.ui, defCopy);
      if (window.SyncBridge.mode === 'desktop') {
        await window.SyncBridge.setDesktopOptions({ autoLaunch: defCopy.autoLaunch, desktopPin: defCopy.desktopPin });
      }
      render();
      await persistAndScheduleSync(false);
      showToast('↺ 已将所有外观、节气、待办与快捷键设置恢复默认值');
    });

    // 三合一智能导入弹窗内卡片点击
    document.querySelectorAll('[data-import-kind]').forEach(btn => {
      btn.addEventListener('click', () => executeSmartImport(btn.dataset.importKind));
    });
    document.getElementById('btn-si-any').addEventListener('click', () => executeSmartImport('auto'));

    // 双击最左侧时间轴 -> 智能批量排作息弹窗事件
    function applyBellAiParseProd() {
      const parsed = parseBellScheduleText(document.getElementById('bb-ai-input').value);
      if (!parsed) { showToast('请先粘贴学校作息时间表或描述一段作息规则'); return; }
      bellCustomGaps = parsed.customGaps || {};
      if (parsed.classDur) document.getElementById('bb-class-dur').value = parsed.classDur;
      if (parsed.breakDur !== undefined) document.getElementById('bb-break-dur').value = parsed.breakDur;
      if (parsed.amStart) document.getElementById('bb-am-start').value = parsed.amStart;
      if (parsed.amCount !== undefined) document.getElementById('bb-am-count').value = parsed.amCount;
      if (parsed.pmStart) document.getElementById('bb-pm-start').value = parsed.pmStart;
      if (parsed.pmCount !== undefined) document.getElementById('bb-pm-count').value = parsed.pmCount;
      if (parsed.evStart) document.getElementById('bb-ev-start').value = parsed.evStart;
      if (parsed.evCount !== undefined) document.getElementById('bb-ev-count').value = parsed.evCount;
      bellEvDur = parsed.evDur || null;
      bellEvBreak = parsed.evBreak !== undefined ? parsed.evBreak : null;

      const sumEl = document.getElementById('bb-ai-summary');
      if (parsed.directPeriods && parsed.directPeriods.length) {
        bellBatchDraft = parsed.directPeriods.slice();
        const amList = bellBatchDraft.filter(p => toMin(p.start) < 750);
        const pmList = bellBatchDraft.filter(p => toMin(p.start) >= 750 && toMin(p.start) < 1080);
        document.getElementById('bell-noon-badge').textContent = (amList.length && pmList.length)
          ? `🍱 中午休息：${formatGapDuration(Math.max(0, toMin(pmList[0].start) - toMin(amList[amList.length - 1].end)))}`
          : `共提取 ${bellBatchDraft.length} 节`;
        renderBellBatchPreview();
        if (sumEl) {
          sumEl.innerHTML = `✅ ${parsed.notes.join(' · ')}（已自动过滤眼操/课间/用餐等非上课行，下方可直接微调后点「一键应用全天作息」）`;
          sumEl.classList.remove('hidden');
        }
        showToast(`⚡ 已直接提取 ${bellBatchDraft.length} 个节次到排表预览`);
        return;
      }

      if (!parsed.notes.length) {
        if (sumEl) {
          sumEl.innerHTML = '⚠️ 未从文本中识别到有效时段（例如 <code>08:00-08:40</code> 或「早上8点开始、下午2点上课」），请检查粘贴内容后重试';
          sumEl.classList.remove('hidden');
        }
        showToast('未能识别有效作息规则，请补充时间段');
        return;
      }

      recalcBellBatchDraft();
      if (sumEl) {
        sumEl.textContent = `✅ 已自动识别：${parsed.notes.join(' · ')}（下方每节与课间已重算）`;
        sumEl.classList.remove('hidden');
      }
      showToast('⚡ AI 已识别作息参数并重排全天节次');
    }
    document.getElementById('btn-bb-ai-parse').addEventListener('click', applyBellAiParseProd);
    document.getElementById('bb-ai-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyBellAiParseProd(); }
    });
    document.querySelectorAll('[data-bb-ai-ex]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('bb-ai-input').value = btn.dataset.bbAiEx;
        applyBellAiParseProd();
      });
    });
    ['bb-big-after', 'bb-big-dur'].forEach(id => document.getElementById(id).addEventListener('input', () => { bellCustomGaps = {}; }));
    ['bb-class-dur', 'bb-break-dur', 'bb-big-after', 'bb-big-dur', 'bb-am-start', 'bb-am-count', 'bb-pm-start', 'bb-pm-count', 'bb-ev-start', 'bb-ev-count'].forEach(id => {
      document.getElementById(id).addEventListener('input', recalcBellBatchDraft);
    });
    document.querySelectorAll('[data-bell-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        bellCustomGaps = {}; bellEvDur = null; bellEvBreak = null;
        const p = btn.dataset.bellPreset;
        if (p === '40-15') {
          document.getElementById('bb-class-dur').value = 40;
          document.getElementById('bb-break-dur').value = 15;
          document.getElementById('bb-big-after').value = '2';
          document.getElementById('bb-big-dur').value = 25;
          document.getElementById('bb-am-start').value = '08:00';
          document.getElementById('bb-pm-start').value = '13:30';
        } else if (p === '40-10') {
          document.getElementById('bb-class-dur').value = 40;
          document.getElementById('bb-break-dur').value = 10;
          document.getElementById('bb-big-after').value = '2';
          document.getElementById('bb-big-dur').value = 30;
          document.getElementById('bb-am-start').value = '08:00';
          document.getElementById('bb-pm-start').value = '13:30';
        } else if (p === '45-10') {
          document.getElementById('bb-class-dur').value = 45;
          document.getElementById('bb-break-dur').value = 10;
          document.getElementById('bb-big-after').value = '2';
          document.getElementById('bb-big-dur').value = 25;
          document.getElementById('bb-am-start').value = '08:00';
          document.getElementById('bb-pm-start').value = '13:40';
        } else if (p === 'summer') {
          document.getElementById('bb-class-dur').value = 40;
          document.getElementById('bb-break-dur').value = 10;
          document.getElementById('bb-big-after').value = '2';
          document.getElementById('bb-big-dur').value = 25;
          document.getElementById('bb-am-start').value = '07:50';
          document.getElementById('bb-pm-start').value = '14:00';
        }
        recalcBellBatchDraft();
      });
    });
    document.getElementById('btn-bb-apply').addEventListener('click', async () => {
      if (!bellBatchDraft.length) return;
      const now = Date.now();
      const oldPeriods = getPeriods().slice().sort((a, b) => toMin(a.start) - toMin(b.start));
      const newPeriods = bellBatchDraft.map((p, i) => ({ num: i + 1, label: p.label, start: p.start, end: p.end }));

      if (document.getElementById('bb-remap-courses').checked) {
        remapCoursesByPeriods(appState.data.timetable.courses || [], oldPeriods, newPeriods, now);
        ensureClassTimetables().forEach(ct => {
          remapCoursesByPeriods(ct.courses || [], oldPeriods, newPeriods, now);
          ct.metaUpdatedAt = now;
        });
        syncLegacyClassTimetableMirror();
      }

      appState.data.timetable.periods = newPeriods;
      appState.data.timetable.metaUpdatedAt = now;
      appState.config.ui.timeStartHour = Math.max(6, Math.floor((toMin(newPeriods[0].start) - 20) / 30) / 2);

      closeModal('modal-bell-batch');
      render();
      await persistAndScheduleSync();
      showToast(`⚡ 已批量更新 ${newPeriods.length} 个节次，左侧时间轴与课表已同步校准！`);
    });

    document.querySelectorAll('[data-set-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchSettingsTab(btn.dataset.setTab));
    });

    // 右上角锁定固定防误触按钮（支持点击切换锁定/解锁）
    const toggleLock = async () => {
      const nextLocked = !isUiLocked;
      applyLockUi(nextLocked);
      appState.config.ui.locked = nextLocked;
      await window.SyncBridge.setDesktopOptions({ locked: nextLocked });
      await persistAndScheduleSync(false);
      showToast(nextLocked ? '🔒 已锁定固定位置与尺寸（防误触已开启）' : '🔓 已解锁，可自由调整窗口并编辑课表');
    };
    document.getElementById('btn-lock').addEventListener('click', toggleLock);

    // 窗口任意拉长/拉宽时自动重新匹配方框与字体比例
    let resizeRaf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => render());
    });

    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
    document.querySelectorAll('.modal-backdrop').forEach(bd => bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.add('hidden'); }));

    // 调课弹窗快捷节次选择
    document.getElementById('rs-period-quick').addEventListener('change', (e) => {
      if (e.target.value === '') return;
      const p = getPeriods()[Number(e.target.value)];
      if (p) {
        document.getElementById('rs-target-start').value = p.start;
        document.getElementById('rs-target-end').value = p.end;
      }
    });

    // 课程颜色选择与调课保存
    document.querySelectorAll('[data-rs-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        rsColorCtx.color = btn.dataset.rsColor;
        rsColorCtx.customBg = '';
        syncRsColorSelection();
      });
    });
    const rsCustomColInp = document.getElementById('rs-custom-color');
    if (rsCustomColInp) {
      rsCustomColInp.addEventListener('input', (e) => {
        rsColorCtx.customBg = e.target.value;
        syncRsColorSelection();
      });
    }

    document.getElementById('btn-rs-save').addEventListener('click', async () => {
      if (!activeRescheduleCtx) return;
      const targetDate = document.getElementById('rs-target-date').value;
      const targetStart = document.getElementById('rs-target-start').value;
      const targetEnd = document.getElementById('rs-target-end').value;
      if (!targetDate || !targetStart || !targetEnd || toMin(targetEnd) <= toMin(targetStart)) {
        showToast('请填写正确的目标日期和起止时间'); return;
      }
      const nextTitle = document.getElementById('rs-title').value.trim() || activeRescheduleCtx.title;
      const nextNote = document.getElementById('rs-note').value.trim();
      const now = Date.now();
      const isClass = activeRescheduleCtx.source === 'class';
      const activeCls = isClass ? getActiveClassTt() : null;
      const cArr = isClass ? (activeCls?.courses || []) : (appState.data.timetable?.courses || []);
      const baseC = cArr.find(c => c.id === activeRescheduleCtx.courseId);
      let colorUpdated = false;
      if (baseC) {
        const prevTitle = baseC.title;
        if (baseC.color !== rsColorCtx.color || (baseC.customBg || '') !== (rsColorCtx.customBg || '')) {
          baseC.color = rsColorCtx.color;
          baseC.customBg = rsColorCtx.customBg;
          baseC.updatedAt = now;
          colorUpdated = true;
        }
        if (document.getElementById('rs-apply-same')?.checked) {
          cArr.forEach(item => {
            if (!item.deleted && (item.title === prevTitle || item.title === nextTitle)) {
              item.color = rsColorCtx.color;
              item.customBg = rsColorCtx.customBg;
              item.updatedAt = now;
            }
          });
        }
        if (colorUpdated) {
          if (isClass && activeCls) { activeCls.metaUpdatedAt = now; syncLegacyClassTimetableMirror(); }
          else if (appState.data.timetable) appState.data.timetable.metaUpdatedAt = now;
        }
      }
      closeModal('modal-reschedule');
      const timeChanged = targetDate !== activeRescheduleCtx.curDate || targetStart !== activeRescheduleCtx.curStart || targetEnd !== activeRescheduleCtx.curEnd || nextTitle !== activeRescheduleCtx.title;
      const noteOnlyChanged = !timeChanged && nextNote !== (activeRescheduleCtx.note || '');
      if (!timeChanged && !noteOnlyChanged && colorUpdated) {
        render(); await persistAndScheduleSync();
        showToast('🎨 已更新课程背景色');
        return;
      }
      if (isClass && baseC && timeChanged) {
        promptClassChangeScope({
          mode: 'edit',
          cls: activeCls,
          course: baseC,
          origDate: activeRescheduleCtx.origDate,
          origWd: getIsoWeekday(parseDate(activeRescheduleCtx.origDate)),
          origStart: activeRescheduleCtx.origStart,
          origEnd: activeRescheduleCtx.origEnd,
          origTitle: baseC.title,
          nextTargetDate: targetDate,
          nextWd: getIsoWeekday(parseDate(targetDate)),
          nextStart: targetStart,
          nextEnd: targetEnd,
          nextTitle,
          note: nextNote,
          overrideId: activeRescheduleCtx.overrideId || null,
        });
        return;
      }
      await applySingleCourseMove({
        ...activeRescheduleCtx,
        title: nextTitle,
        note: nextNote,
        targetDate, targetStart, targetEnd,
      });
    });

    document.getElementById('btn-rs-cancel-once').addEventListener('click', async () => {
      if (!activeRescheduleCtx) return;
      const now = Date.now();
      const isClass = activeRescheduleCtx.source === 'class';
      const activeCls = isClass ? getActiveClassTt() : null;
      if (isClass && !activeCls.overrides) activeCls.overrides = [];
      const list = isClass ? activeCls.overrides : appState.data.overrides;
      let ov = activeRescheduleCtx.overrideId
        ? list.find(o => o.id === activeRescheduleCtx.overrideId)
        : list.find(o => o.courseId === activeRescheduleCtx.courseId && o.origDate === activeRescheduleCtx.origDate);
      if (!ov) {
        list.push({ id: uid('ov'), courseId: activeRescheduleCtx.courseId, origDate: activeRescheduleCtx.origDate, origStart: activeRescheduleCtx.origStart, origEnd: activeRescheduleCtx.origEnd, type: 'cancel', title: activeRescheduleCtx.title, updatedAt: now, deleted: false });
      } else { ov.type = 'cancel'; ov.deleted = false; ov.updatedAt = now; }
      if (isClass && activeCls) { activeCls.metaUpdatedAt = now; syncLegacyClassTimetableMirror(); }
      closeModal('modal-reschedule'); render(); await persistAndScheduleSync();
      showToast('已标记为单次停课');
    });

    document.getElementById('btn-rs-restore').addEventListener('click', async () => {
      if (!activeRescheduleCtx?.overrideId) return;
      const isClass = activeRescheduleCtx.source === 'class';
      const activeCls = isClass ? getActiveClassTt() : null;
      const list = isClass ? (activeCls?.overrides || []) : appState.data.overrides;
      const ov = list.find(o => o.id === activeRescheduleCtx.overrideId);
      if (ov) { ov.deleted = true; ov.updatedAt = Date.now(); }
      if (isClass && activeCls) { activeCls.metaUpdatedAt = Date.now(); syncLegacyClassTimetableMirror(); }
      closeModal('modal-reschedule'); render(); await persistAndScheduleSync();
      showToast('已恢复原课表');
    });

    document.getElementById('btn-cscope-week')?.addEventListener('click', () => executeClassScope('week'));
    document.getElementById('btn-cscope-term')?.addEventListener('click', () => executeClassScope('term'));

    // 全局让软件内所有弹窗标题栏均可用鼠标自由拖动，且每次打开均从固定上方正中央弹出
    function enableAllModalsDraggable() {
      document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        const box = backdrop.querySelector('.modal');
        const hdr = backdrop.querySelector('.modal-header');
        if (!box || !hdr || hdr.dataset.dragBound) return;
        hdr.dataset.dragBound = '1';

        let wasHidden = backdrop.classList.contains('hidden');
        if (typeof MutationObserver !== 'undefined') {
          new MutationObserver(() => {
            const nowHidden = backdrop.classList.contains('hidden');
            if (wasHidden && !nowHidden) {
              box.style.transform = '';
              box.dataset.dragOx = '0';
              box.dataset.dragOy = '0';
            }
            wasHidden = nowHidden;
          }).observe(backdrop, { attributes: true, attributeFilter: ['class'] });
        }

        hdr.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button, input, select, a')) return;
          const sx = e.clientX, sy = e.clientY;
          const ox = Number(box.dataset.dragOx || 0), oy = Number(box.dataset.dragOy || 0);
          function onMove(ev) {
            const nx = ox + ev.clientX - sx, ny = oy + ev.clientY - sy;
            box.dataset.dragOx = String(nx);
            box.dataset.dragOy = String(ny);
            box.style.transform = `translate(${nx}px, ${ny}px)`;
          }
          function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          }
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      });
    }
    enableAllModalsDraggable();

    function fillWorkModalFromAi() {
      const raw = document.getElementById('wk-ai-raw')?.value || '';
      const parsed = parseNaturalLanguageWork(raw);
      if (!parsed) { showToast('请先粘贴或输入一段通知内容'); return; }
      document.getElementById('wk-title').value = parsed.title;
      document.getElementById('wk-date').value = parsed.date;
      document.getElementById('wk-start').value = parsed.start;
      document.getElementById('wk-end').value = parsed.end;
      document.getElementById('wk-urgent').checked = parsed.urgent;
      updateWorkConflictPreview();
      showToast(`✨ 已自动识别：${parsed.date.slice(5)} ${parsed.start}-${parsed.end}`);
    }
    document.getElementById('btn-wk-ai-fill')?.addEventListener('click', fillWorkModalFromAi);
    document.getElementById('wk-ai-raw')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fillWorkModalFromAi(); }
    });

    ['wk-date', 'wk-start', 'wk-end'].forEach(id => document.getElementById(id).addEventListener('input', updateWorkConflictPreview));
    document.getElementById('btn-wk-save').addEventListener('click', async () => {
      const title = document.getElementById('wk-title').value.trim();
      const date = document.getElementById('wk-date').value, start = document.getElementById('wk-start').value, end = document.getElementById('wk-end').value;
      if (!title || !date || !start || !end || toMin(end) <= toMin(start)) { showToast('请填写事项名称和正确的起止时间'); return; }
      const now = Date.now();
      const rec = { title, date, start, end, urgent: document.getElementById('wk-urgent').checked, done: document.getElementById('wk-done').checked, note: document.getElementById('wk-note').value.trim(), updatedAt: now, deleted: false };
      if (activeWorkId) Object.assign(appState.data.works.find(x => x.id === activeWorkId), rec);
      else appState.data.works.push({ id: uid('w'), ...rec });
      closeModal('modal-work'); render(); await persistAndScheduleSync();
      showToast('已保存干活事项');
    });
    document.getElementById('btn-wk-delete').addEventListener('click', async () => {
      const w = appState.data.works.find(x => x.id === activeWorkId);
      if (w) { w.deleted = true; w.updatedAt = Date.now(); }
      closeModal('modal-work'); render(); await persistAndScheduleSync();
      showToast('已删除事项');
    });

    // 课表与作息管理弹窗（支持双击编辑 + 多班级管理）
    document.querySelectorAll('[data-tt-tab]').forEach(btn => {
      btn.addEventListener('click', () => { activeTtTab = btn.dataset.ttTab; editingTtCourseId = null; renderTimetableManager(); });
    });
    document.getElementById('tt-add-period').addEventListener('change', (e) => {
      if (e.target.value === '') return;
      const p = getPeriods()[Number(e.target.value)];
      if (p) {
        document.getElementById('tt-add-start').value = p.start;
        document.getElementById('tt-add-end').value = p.end;
      }
    });
    document.getElementById('tt-term-start').addEventListener('change', async (e) => {
      appState.data.timetable.termStartDate = e.target.value;
      appState.data.timetable.metaUpdatedAt = Date.now();
      render(); await persistAndScheduleSync();
    });
    const renameActiveClass = async () => {
      const activeCls = getActiveClassTt();
      const nextName = document.getElementById('tt-class-name').value.trim();
      if (!nextName) return;
      activeCls.className = nextName;
      activeCls.metaUpdatedAt = Date.now();
      syncLegacyClassTimetableMirror();
      renderTimetableManager(); render(); await persistAndScheduleSync();
      showToast(`已将班级更名为「${nextName}」`);
    };
    document.getElementById('tt-class-name').addEventListener('change', renameActiveClass);
    document.getElementById('btn-tt-rename-cls')?.addEventListener('click', renameActiveClass);
    document.getElementById('btn-tt-add-cls')?.addEventListener('click', async () => {
      const nc = addNewClassTimetable();
      if (nc) {
        renderTimetableManager(); render(); await persistAndScheduleSync();
        showToast(`已新建班级「${nc.className}」（可点智能导入或下方添加课程）`);
      }
    });
    document.getElementById('btn-tt-del-cls')?.addEventListener('click', async () => {
      const list = ensureClassTimetables();
      if (list.length <= 1) { showToast('至少保留 1 个班级课表'); return; }
      const cur = getActiveClassTt();
      appState.data.classTimetables = list.filter(x => x.id !== cur.id);
      appState.data.activeClassId = appState.data.classTimetables[0].id;
      editingTtCourseId = null;
      syncLegacyClassTimetableMirror();
      renderTimetableManager(); render(); await persistAndScheduleSync();
      showToast(`已删除班级「${cur.className}」`);
    });
    document.getElementById('btn-tt-add').addEventListener('click', async () => {
      const weekday = Number(document.getElementById('tt-add-day').value);
      const start = document.getElementById('tt-add-start').value, end = document.getElementById('tt-add-end').value;
      const title = document.getElementById('tt-add-title').value.trim();
      const parity = document.getElementById('tt-add-parity')?.value || 'all';
      if (!title || toMin(end) <= toMin(start)) { showToast('请输入课程名称与正确起止时间'); return; }
      const useCustomCol = document.getElementById('tt-add-use-color')?.checked;
      const customBg = useCustomCol ? (document.getElementById('tt-add-color')?.value || '') : '';
      const now = Date.now();
      const activeCls = activeTtTab === 'class' ? getActiveClassTt() : null;
      const targetArr = activeCls ? activeCls.courses : appState.data.timetable.courses;
      targetArr.push({ id: uid(activeTtTab === 'class' ? 'cc' : 'c'), weekday, start, end, title, room: '', parity, color: guessColor(title), customBg, updatedAt: now, deleted: false });
      if (activeCls) { activeCls.metaUpdatedAt = now; syncLegacyClassTimetableMirror(); }
      else if (appState.data.timetable) appState.data.timetable.metaUpdatedAt = now;
      document.getElementById('tt-add-title').value = '';
      renderTimetableManager(); render(); await persistAndScheduleSync();
    });
    document.getElementById('btn-tt-clear').addEventListener('click', async () => {
      const now = Date.now();
      const activeCls = activeTtTab === 'class' ? getActiveClassTt() : null;
      const targetArr = activeCls ? activeCls.courses : appState.data.timetable.courses;
      targetArr.forEach(c => { c.deleted = true; c.updatedAt = now; });
      if (activeCls) { activeCls.metaUpdatedAt = now; syncLegacyClassTimetableMirror(); }
      else if (appState.data.timetable) appState.data.timetable.metaUpdatedAt = now;
      editingTtCourseId = null;
      renderTimetableManager(); render(); await persistAndScheduleSync();
      showToast('已清空当前课表');
    });
    document.getElementById('btn-schedule-import').addEventListener('click', () => {
      openSmartImportModal(activeTtTab === 'class' ? 'class' : 'my');
    });
    document.getElementById('btn-excel-template').addEventListener('click', async () => {
      const res = await window.SyncBridge.exportExcelTemplate();
      if (!res || res.canceled) return;
      showToast(res.ok ? '已导出标准模板（含个人与班主任班级课表）' : (res.message || '导出失败'));
    });
    document.getElementById('btn-pd-add').addEventListener('click', async () => {
      const label = document.getElementById('pd-new-label').value.trim();
      const start = document.getElementById('pd-new-start').value, end = document.getElementById('pd-new-end').value;
      if (!label || toMin(end) <= toMin(start)) { showToast('请填写节次名称和正确起止时间'); return; }
      appState.data.timetable.periods.push({ num: appState.data.timetable.periods.length + 1, label, start, end });
      appState.data.timetable.metaUpdatedAt = Date.now();
      document.getElementById('pd-new-label').value = '';
      renderTimetableManager(); render(); await persistAndScheduleSync();
    });

    // 坚果云同步设置
    const collectDav = () => ({
      serverUrl: document.getElementById('dav-url').value.trim() || 'https://dav.jianguoyun.com/dav/',
      username: document.getElementById('dav-user').value.trim(),
      folder: document.getElementById('dav-folder').value.trim() || 'TeacherCal',
      password: document.getElementById('dav-pass').value.trim(),
      autoSync: document.getElementById('dav-auto').checked,
      intervalSec: 180,
    });
    document.getElementById('btn-dav-test').addEventListener('click', async () => {
      const box = document.getElementById('dav-test-result');
      box.className = 'hint-box'; box.textContent = '正在连接坚果云 WebDAV…'; box.classList.remove('hidden');
      const res = await window.SyncBridge.testWebDav(collectDav());
      box.className = res.ok ? 'hint-box' : 'warn-box'; box.textContent = res.message;
    });
    document.getElementById('btn-dav-save').addEventListener('click', async () => {
      appState.config.webdav = collectDav();
      await window.SyncBridge.saveState(appState);
      refreshSyncBadgeFromState();
      showToast('坚果云同步配置已保存');
      if (appState.config.webdav.password && appState.config.webdav.autoSync) performSync(false);
    });
    document.getElementById('btn-desktop-opt-save').addEventListener('click', async () => {
      if (window.SyncBridge.mode === 'desktop') {
        const autoLaunch = document.getElementById('opt-autolaunch').checked;
        const desktopPin = document.getElementById('opt-desktop-pin').checked;
        appState.config.ui.autoLaunch = autoLaunch;
        appState.config.ui.desktopPin = desktopPin;
        await window.SyncBridge.setDesktopOptions({ autoLaunch, desktopPin });
        await window.SyncBridge.saveState(appState);
        showToast('桌面选项已保存');
      }
    });
    document.getElementById('btn-dav-sync-now').addEventListener('click', async () => {
      appState.config.webdav = collectDav();
      await window.SyncBridge.saveState(appState);
      await performSync(false);
    });

    // 在线更新弹窗
    document.getElementById('btn-upd-check').addEventListener('click', async () => {
      appState.config.updater = {
        sourceUrl: document.getElementById('upd-source').value.trim(),
        autoCheck: document.getElementById('upd-auto-check').checked,
      };
      await window.SyncBridge.saveState(appState);
      document.getElementById('btn-upd-apply')?.classList.add('hidden');
      const box = document.getElementById('upd-status-box');
      box.className = 'hint-box'; box.textContent = '正在在线检查最新版本…'; box.classList.remove('hidden');
      await runUpdateCheck(false);
    });
    document.getElementById('btn-upd-apply').addEventListener('click', async () => {
      if (!latestUpdateInfo?.downloadUrl) return;
      const box = document.getElementById('upd-status-box');
      box.className = 'hint-box'; box.textContent = '正在下载更新包并自动应用，请稍候…';
      const res = await window.SyncBridge.applyUpdate(latestUpdateInfo.downloadUrl);
      box.className = res.ok ? 'hint-box' : 'warn-box';
      box.textContent = res.message;
    });

    if (window.desktopApi) {
      window.desktopApi.onStateUpdated((next) => { appState = next; ensureClassTimetables(); ensureUiPrefs(); render(); });
      window.desktopApi.onLockChanged((locked) => {
        if (appState?.config?.ui) appState.config.ui.locked = !!locked;
        applyLockUi(locked);
      });
      if (typeof window.desktopApi.onHotkeyAction === 'function') {
        window.desktopApi.onHotkeyAction(async (action) => {
          if (action === 'priv') togglePrivacyMask();
          else if (action === 'memo') {
            if (appState?.config?.ui?.homeroomMode) await setHomeroomMode(false);
            openWorkModal(null);
          }
        });
      }
    }

    if (window.SyncBridge.mode !== 'desktop') {
      window.addEventListener('keydown', async (e) => {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae.tagName === 'INPUT' && !ae.classList.contains('shortcut-key-box')))) return;
        if (ae && ae.classList.contains('shortcut-key-box')) return;
        const combo = formatShortcutEv(e);
        if (!combo || !appState) return;
        const hk = ensureUiPrefs().hotkeys;
        if (hk.hide?.enabled && combo === hk.hide.key) {
          e.preventDefault();
          showToast('已触发隐藏快捷键（Windows 桌面版支持一键收纳至系统托盘）');
        } else if (hk.priv?.enabled && combo === hk.priv.key) {
          e.preventDefault();
          togglePrivacyMask();
        } else if (hk.lock?.enabled && combo === hk.lock.key) {
          e.preventDefault();
          await toggleLock();
        } else if (hk.memo?.enabled && combo === hk.memo.key) {
          e.preventDefault();
          if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
          openWorkModal(null);
        }
      });
    }

    // 待排清单（随手记事 + 一键智能排入今日空堂）
    document.getElementById('btn-inbox-toggle').addEventListener('click', () => {
      const dr = document.getElementById('inbox-drawer');
      dr.classList.toggle('hidden');
      if (!dr.classList.contains('hidden')) document.getElementById('inbox-input').focus();
    });
    const addInboxEntry = async () => {
      const inp = document.getElementById('inbox-input');
      const txt = inp.value.trim();
      if (!txt) return;
      if (!Array.isArray(appState.data.inbox)) appState.data.inbox = [];
      appState.data.inbox.unshift({ id: uid('ib'), text: txt, done: false });
      inp.value = '';
      renderInbox();
      await persistAndScheduleSync(false);
    };
    document.getElementById('btn-inbox-add').addEventListener('click', addInboxEntry);
    document.getElementById('inbox-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addInboxEntry(); });

    // 上课前 5 分钟 & 待办到点提醒开关与试听
    document.getElementById('opt-reminder').addEventListener('change', async (e) => {
      appState.config.ui.reminderEnabled = !!e.target.checked;
      await persistAndScheduleSync(false);
      showToast(appState.config.ui.reminderEnabled ? '🔔 已开启上课前 5 分钟与待办到点提醒' : '已静音卡片提醒');
    });
    document.getElementById('btn-test-reminder').addEventListener('click', () => {
      showReminderCard({ title: '🔔 还有 5 分钟上课（试听）', body: '<strong>902 历史</strong><br/>上课时间：08:00 - 08:40，请提前准备教学资料', urgent: false });
    });
    document.getElementById('btn-rem-close').addEventListener('click', () => document.getElementById('reminder-popup').classList.add('hidden'));
    document.getElementById('btn-rem-action').addEventListener('click', async () => {
      if (activeReminderWorkId) {
        const w = (appState.data.works || []).find(x => x.id === activeReminderWorkId);
        if (w) {
          w.done = true; w.updatedAt = Date.now();
          if (appState.config.ui.doneSound !== 'none') playSoundEffect(appState.config.ui.doneSound);
          render(); await persistAndScheduleSync(); showToast(`☑ 已完成：${w.title}`);
        }
      }
      document.getElementById('reminder-popup').classList.add('hidden');
    });

    // 法定节假日 / 周末补课快捷标记弹窗事件
    document.querySelectorAll('[data-hol-preset]').forEach(btn => {
      btn.addEventListener('click', () => { document.getElementById('dm-holiday-label').value = btn.dataset.holPreset; });
    });
    document.getElementById('btn-dm-set-holiday').addEventListener('click', async () => {
      if (!activeDayModeDate) return;
      if (!appState.data.dayOverrides) appState.data.dayOverrides = {};
      const label = document.getElementById('dm-holiday-label').value.trim() || '法定节假日';
      appState.data.dayOverrides[activeDayModeDate] = { type: 'holiday', label };
      closeModal('modal-day-mode'); render(); await persistAndScheduleSync(false);
      showToast(`🏖 已将 ${activeDayModeDate.slice(5)} 标记为「${label}」`);
    });
    document.getElementById('btn-dm-set-makeup').addEventListener('click', async () => {
      if (!activeDayModeDate) return;
      if (!appState.data.dayOverrides) appState.data.dayOverrides = {};
      const wd = Number(document.getElementById('dm-makeup-wd').value);
      const wdNames = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五' };
      appState.data.dayOverrides[activeDayModeDate] = { type: 'makeup', sourceWeekday: wd, label: `补${wdNames[wd]}` };
      closeModal('modal-day-mode'); render(); await persistAndScheduleSync(false);
      showToast(`📚 已将 ${activeDayModeDate.slice(5)} 设为调休补课（按${wdNames[wd]}课表）`);
    });
    document.getElementById('btn-dm-clear').addEventListener('click', async () => {
      if (!activeDayModeDate || !appState.data.dayOverrides) return;
      delete appState.data.dayOverrides[activeDayModeDate];
      closeModal('modal-day-mode'); render(); await persistAndScheduleSync(false);
      showToast(`↩ 已恢复 ${activeDayModeDate.slice(5)} 正常排课`);
    });
  }

  function renderInbox() {
    const box = document.getElementById('inbox-list');
    const toggleBtn = document.getElementById('btn-inbox-toggle');
    if (!box || !toggleBtn || !appState) return;
    const ui = appState?.config?.ui || DEFAULT_UI_PREFS;
    const inbox = Array.isArray(appState.data.inbox) ? appState.data.inbox : [];
    const pendingCnt = inbox.filter(x => !x.done).length;
    toggleBtn.textContent = pendingCnt ? `📥 待排清单(${pendingCnt})` : '📥 待排清单';
    let list = inbox.filter(x => ui.showDoneWork !== false || !x.done);
    if (ui.doneToBottom !== false) {
      list = list.slice().sort((a, b) => Number(!!a.done) - Number(!!b.done));
    }
    box.innerHTML = list.map((it, idx) => `
      <div class="inbox-chip ${it.done ? 'done' : ''}">
        <input type="checkbox" ${it.done ? 'checked' : ''} data-ib-chk="${it.id}" />
        <span class="ib-txt">${formatWorkPrefix(idx)}${escapeHtml(it.text)}</span>
        ${!it.done ? `<button class="inbox-auto-btn" data-ib-plan="${it.id}">排入空堂</button>` : ''}
        <button class="inbox-del-btn" data-ib-del="${it.id}" title="移除">✕</button>
      </div>
    `).join('') || `<span style="font-size:11.5px;color:var(--text-muted);">暂无待排事务，可在左侧输入回车记下</span>`;

    box.querySelectorAll('[data-ib-chk]').forEach(el => el.addEventListener('change', async () => {
      const item = appState.data.inbox.find(x => x.id === el.dataset.ibChk);
      if (item) {
        item.done = el.checked;
        if (item.done && appState.config.ui.doneSound !== 'none') playSoundEffect(appState.config.ui.doneSound);
        renderInbox(); await persistAndScheduleSync(false);
      }
    }));
    box.querySelectorAll('[data-ib-del]').forEach(el => el.addEventListener('click', async () => {
      appState.data.inbox = appState.data.inbox.filter(x => x.id !== el.dataset.ibDel);
      renderInbox(); await persistAndScheduleSync(false);
    }));
    box.querySelectorAll('[data-ib-plan]').forEach(el => el.addEventListener('click', async () => {
      const item = appState.data.inbox.find(x => x.id === el.dataset.ibPlan);
      if (!item) return;
      const todayStr = fmtDate(new Date());
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const { activeList } = getEffectiveCoursesForDate(todayStr, 'my');
      const busy = [
        ...activeList.map(c => [toMin(c.start), toMin(c.end)]),
        ...(appState.data.works || []).filter(w => !w.deleted && w.date === todayStr).map(w => [toMin(w.start), toMin(w.end)]),
      ];
      const periods = getPeriods().filter(p => toMin(p.start) >= Math.max(480, nowMin) && toMin(p.end) <= 1050);
      const slot = periods.find(p => !busy.some(([bs, be]) => Math.max(toMin(p.start), bs) < Math.min(toMin(p.end), be))) || getPeriods()[1] || getPeriods()[0];
      if (!slot) return;
      appState.data.works.push({ id: uid('w'), date: todayStr, start: slot.start, end: slot.end, title: item.text, note: '来自待排清单自动排入', urgent: false, done: false, updatedAt: Date.now(), deleted: false });
      appState.data.inbox = appState.data.inbox.filter(x => x.id !== item.id);
      if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
      else { appState.config.ui.showWork = true; render(); await persistAndScheduleSync(); }
      showToast(`📥 已为「${item.text}」排入今日空堂 ${slot.start}-${slot.end}`);
    }));
  }

  const firedReminders = new Set();
  let activeReminderWorkId = null;
  let reminderAutoHide = null;

  function playSoundEffect(kind = 'chime') {
    if (!kind || kind === 'none') return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const seqMap = {
        ding: [[988, 0, 0.24]],
        bubble: [[523, 0, 0.14], [784, 0.09, 0.20]],
        chime: [[660, 0, 0.34], [880, 0.14, 0.36]],
        dong: [[440, 0, 0.42], [330, 0.18, 0.48]],
        wind: [[784, 0, 0.22], [988, 0.11, 0.24], [1175, 0.22, 0.34]],
      };
      const notes = seqMap[kind] || seqMap.chime;
      notes.forEach(([freq, delay, dur]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const t0 = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      });
    } catch {}
  }

  function playSoftChime() {
    playSoundEffect(appState?.config?.ui?.remSound || 'chime');
  }

  function showReminderCard({ title, body, urgent, workId }) {
    activeReminderWorkId = workId || null;
    const pop = document.getElementById('reminder-popup');
    if (!pop) return;
    pop.classList.toggle('urgent-rem', !!urgent);
    document.getElementById('rem-title').textContent = title;
    document.getElementById('rem-title').style.color = urgent ? 'var(--apple-red)' : 'var(--apple-blue)';
    document.getElementById('rem-body').innerHTML = body;
    document.getElementById('btn-rem-action').textContent = workId ? '☑ 标记完成' : '知道了';
    pop.classList.remove('hidden');
    playSoftChime();
    clearTimeout(reminderAutoHide);
    reminderAutoHide = setTimeout(() => pop.classList.add('hidden'), 12000);
  }

  function checkReminders() {
    if (!appState || appState.config.ui.reminderEnabled === false) return;
    const todayStr = fmtDate(new Date());
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const { activeList } = getEffectiveCoursesForDate(todayStr, appState.config.ui.homeroomMode ? 'class' : 'my');
    for (const c of activeList) {
      const diff = toMin(c.start) - nowMin;
      const key = `${todayStr}:c:${c.courseId}:${c.start}`;
      if (diff >= 1 && diff <= 5 && !firedReminders.has(key)) {
        firedReminders.add(key);
        showReminderCard({ title: `🔔 还有 ${diff} 分钟上课`, body: `<strong>${escapeHtml(c.title)}</strong><br/>上课时间：${c.start} - ${c.end}`, urgent: false });
        return;
      }
    }
    if (!appState.config.ui.homeroomMode) {
      const wks = (appState.data.works || []).filter(w => !w.deleted && !w.done && w.date === todayStr);
      for (const w of wks) {
        const diff = nowMin - toMin(w.start);
        const key = `${todayStr}:w:${w.id}:${w.start}`;
        if (diff >= 0 && diff <= 2 && !firedReminders.has(key)) {
          firedReminders.add(key);
          showReminderCard({ title: '⏰ 待办事项已到点', body: `<strong>${escapeHtml(w.title)}</strong><br/>计划时间：${w.start} - ${w.end}`, urgent: !!w.urgent, workId: w.id });
          return;
        }
      }
    }
  }

  let activeDayModeDate = null;
  function openDayModeModal(ds) {
    activeDayModeDate = ds;
    const d = parseDate(ds);
    const cur = appState.data.dayOverrides && appState.data.dayOverrides[ds];
    const dmBox = document.querySelector('#modal-day-mode .modal');
    if (dmBox) { dmBox.style.transform = ''; dmBox.dataset.dragOx = '0'; dmBox.dataset.dragOy = '0'; }
    document.getElementById('dm-date-title').textContent = `📅 ${ds}（${WEEKDAYS_CN[d.getDay()]}）排课标记`;
    if (cur && cur.type === 'holiday') document.getElementById('dm-holiday-label').value = cur.label || '法定节假日';
    if (cur && cur.type === 'makeup' && cur.sourceWeekday) document.getElementById('dm-makeup-wd').value = String(cur.sourceWeekday);
    openModal('modal-day-mode');
  }

  async function init() {
    bindGlobalEvents();
    appState = await window.SyncBridge.loadState();
    ensureClassTimetables();
    ensureUiPrefs();
    isUiLocked = !!appState?.config?.ui?.locked;
    render();
    pushAndroidWidgetSummary();

    if (appState.config.webdav.password && appState.config.webdav.autoSync) {
      setTimeout(() => performSync(true), 1200);
    }
    if (appState.config.updater?.autoCheck && appState.config.updater?.sourceUrl) {
      setTimeout(() => runUpdateCheck(true), 2500);
    }
    pollSyncTimer = setInterval(() => {
      if (appState?.config?.webdav?.password && appState.config.webdav.autoSync) performSync(true);
    }, 180000);

    // 每 30 秒平滑推进苹果日历红线与已流逝遮罩
    setInterval(() => {
      if (currentView !== 'month') render();
    }, 30000);
  }

  init();
})();

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
  let activeSettingsTab = 'sync'; // 'sync' | 'theme' | 'desktop' | 'update'
  let activeImportTarget = 'class'; // 'my' | 'class'
  let latestUpdateInfo = null;
  let savedPersonalLayers = { showCourse: true, showWork: true };
  const darkMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function formatLunarText(d) {
    try {
      const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' }).formatToParts(d);
      const mVal = parseInt(parts.find(p => p.type === 'month')?.value || '0', 10);
      const dVal = parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
      const isLeap = parts.some(p => p.type === 'month' && /闰/.test(p.value));
      if (mVal >= 1 && mVal <= 12 && dVal >= 1 && dVal <= 30) {
        return `农历${isLeap ? '闰' : ''}${LUNAR_MONTHS[mVal]}${LUNAR_DAYS[dVal]}`;
      }
      return '农历' + new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' }).format(d);
    } catch {
      return '';
    }
  }

  function updateTopbarDateLabel() {
    const titleEl = document.getElementById('topbar-full-date');
    const chipEl = document.getElementById('topbar-week-chip');
    const d = anchorDate;
    const lunar = formatLunarText(d);
    if (titleEl) {
      titleEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS_FULL[d.getDay()]}${lunar ? ' ' + lunar : ''}`;
    }
    if (chipEl && appState) {
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

  // ===== 核心：计算某天生效的课表（支持 source='my' 个人底层课表 / source='class' 班主任班级课表） =====
  function getEffectiveCoursesForDate(dateStr, source = 'my') {
    const d = parseDate(dateStr);
    const weekday = getIsoWeekday(d);
    const weekNum = getWeekNumber(dateStr);
    const parityNow = weekNum % 2 === 0 ? 'even' : 'odd';

    const rawCourses = source === 'class'
      ? (appState.data.classTimetable?.courses || [])
      : (appState.data.timetable?.courses || []);
    const rawOverrides = source === 'class'
      ? (appState.data.classTimetable?.overrides || [])
      : (appState.data.overrides || []);

    const courses = rawCourses.filter(c => !c.deleted);
    const overrides = rawOverrides.filter(o => !o.deleted);
    const activeList = [];
    const ghostList = [];

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

  // ===== 应用主题与 UI 控件同步 =====
  function applyUiControlsFromState() {
    const ui = appState.config.ui;
    const themeMode = ['light', 'dark', 'auto'].includes(ui.theme) ? ui.theme : 'auto';
    const resolvedTheme = resolveEffectiveTheme(themeMode);
    document.documentElement.setAttribute('data-theme', resolvedTheme);

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

    const className = appState.data.classTimetable?.className || '902班';
    document.getElementById('homeroom-label-text').textContent = `🏫 班主任班级课表（${className}）`;
    document.getElementById('homeroom-banner-text').textContent = `🏫 班主任专属视图：${className} 全周课程（已隐藏个人课表与干活）`;

    document.getElementById('chk-homeroom').checked = homeroomOn;
    document.getElementById('pill-homeroom').classList.toggle('active-homeroom', homeroomOn);

    document.getElementById('chk-show-course').checked = !homeroomOn && ui.showCourse !== false;
    document.getElementById('chk-show-work').checked = !homeroomOn && ui.showWork !== false;
    document.getElementById('pill-course').classList.toggle('dimmed', homeroomOn);
    document.getElementById('pill-work').classList.toggle('dimmed', homeroomOn);

    document.getElementById('chk-magnet').checked = ui.magnetSnap !== false;
    document.getElementById('rng-course-opacity').value = ui.courseOpacity ?? 78;
    document.getElementById('rng-work-opacity').value = ui.workOpacity ?? 92;
    document.getElementById('rng-bg-alpha').value = ui.bgAlpha ?? 72;
    const bgAlphaSet = document.getElementById('rng-bg-alpha-set');
    if (bgAlphaSet) bgAlphaSet.value = ui.bgAlpha ?? 72;

    const btnEvening = document.getElementById('btn-toggle-evening');
    const btnWeekend = document.getElementById('btn-toggle-weekend');
    btnEvening.classList.toggle('active', !!ui.showEvening);
    btnEvening.textContent = ui.showEvening ? '🌃 晚自习：开' : '🌃 展示晚自习';
    btnWeekend.classList.toggle('active', !!ui.showWeekend);
    btnWeekend.textContent = ui.showWeekend ? '📅 周末：开' : '📅 展示周末';

    document.documentElement.style.setProperty('--bg-alpha', String((ui.bgAlpha ?? 72) / 100));

    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === currentView);
    });
  }

  function applyLockUi(locked) {
    isUiLocked = !!locked;
    document.body.classList.toggle('ui-locked', isUiLocked);
    const lockBtn = document.getElementById('btn-lock');
    const lockSvg = document.getElementById('lock-svg');
    if (lockBtn) {
      lockBtn.classList.toggle('btn-lock-active', isUiLocked);
      lockBtn.title = isUiLocked
        ? '当前已锁定防误触，点击立即解锁（或按 Ctrl+Alt+L）'
        : '锁定固定防误触（锁定后窗口不可拖动缩放，课表与编辑按钮禁用）';
    }
    if (lockSvg) {
      lockSvg.innerHTML = isUiLocked
        ? '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>'
        : '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
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

  function render() {
    if (!appState) return;
    applyUiControlsFromState();
    applyLockUi(isUiLocked);
    refreshSyncBadgeFromState();
    updateTopbarDateLabel();
    updateResponsiveLayout();

    const vp = document.getElementById('main-viewport');
    if (currentView === 'month') renderMonthView(vp);
    else renderTimelineView(vp);
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
        return `<div class="timeline-header-cell ${isTd ? 'today' : ''}" data-header-date="${ds}">${WEEKDAYS_CN[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}${isTd ? ' · 今天' : ''}</div>`;
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
        const label = (bEnd - bStart) >= 50 ? '午休 / 大休' : (h >= 13 ? '课间' : '');
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
      let colInner = linesHtml;

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
          const height = Math.max(24, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          const isMine = /历史|道法|地理|班会|（张）|\(张\)/.test(c.title);
          colInner += `
            <div class="course-block course-${c.color} ${isMine ? 'my-class-highlight' : ''}" style="top:${top}px;height:${height}px;opacity:0.94"
                 data-course-source="class"
                 data-course-id="${c.courseId}" data-orig-date="${c.origDate}" data-orig-start="${c.origStart}" data-orig-end="${c.origEnd}"
                 data-cur-date="${c.date}" data-cur-start="${c.start}" data-cur-end="${c.end}"
                 data-cur-title="${escapeAttr(c.title)}" data-cur-note="${escapeAttr(c.note)}" data-override-id="${c.overrideId || ''}">
              <div class="course-title">
                ${c.isMoved ? '<span class="badge-moved">调</span>' : ''}
                ${isMine ? '<span title="我任教的课">★</span>' : ''}
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.title)}</span>
              </div>
              ${height >= 34 ? `<div class="course-time">${c.start}-${c.end}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>` : ''}
            </div>`;
        });
        return `<div class="day-col ${isTd ? 'today-col' : ''}" data-col-date="${ds}" style="height:${canvasHeight}px">${colInner}</div>`;
      }

      // ===== 分支 2：个人双图层模式（底层我的课表 + 顶层干活叠加） =====
      const { activeList, ghostList } = getEffectiveCoursesForDate(ds, 'my');
      const dayWorks = (appState.data.works || []).filter(w => !w.deleted && w.date === ds);

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
          const height = Math.max(24, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          colInner += `
            <div class="course-block course-${c.color}" style="top:${top}px;height:${height}px;opacity:${opCourse}"
                 data-course-source="my"
                 data-course-id="${c.courseId}" data-orig-date="${c.origDate}" data-orig-start="${c.origStart}" data-orig-end="${c.origEnd}"
                 data-cur-date="${c.date}" data-cur-start="${c.start}" data-cur-end="${c.end}"
                 data-cur-title="${escapeAttr(c.title)}" data-cur-note="${escapeAttr(c.note)}" data-override-id="${c.overrideId || ''}"
                 title="按住拖动可磁吸跳过课间单次调课，点击可调到任意日期">
              <div class="course-title">
                ${c.isMoved ? '<span class="badge-moved">调</span>' : ''}
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.title)}</span>
              </div>
              ${height >= 34 ? `<div class="course-time">${c.start}-${c.end}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>` : ''}
            </div>`;
        });
      }

      if (showWork) {
        dayWorks.forEach(w => {
          const s = toMin(w.start), e = toMin(w.end);
          if (e <= range.start || s >= range.end) return;
          const top = Math.max(0, (s - range.start) * PX_PER_MIN);
          const height = Math.max(24, (Math.min(e, range.end) - Math.max(s, range.start)) * PX_PER_MIN);
          const isOverlap = showCourse && activeList.some(c => Math.max(s, toMin(c.start)) < Math.min(e, toMin(c.end)));
          const cls = ['work-block'];
          if (w.urgent) cls.push('urgent');
          if (isOverlap) cls.push('overlap');
          if (w.done) cls.push('done');
          colInner += `
            <div class="${cls.join(' ')}" style="top:${top}px;height:${height}px;opacity:${opWork}" data-work-id="${w.id}">
              <div class="work-header">
                <span class="work-check" data-toggle-done="${w.id}">${w.done ? '☑' : '☐'}</span>
                <span class="work-title-text">${isOverlap ? '⚡ ' : ''}${escapeHtml(w.title)}</span>
              </div>
              ${height >= 34 ? `<div class="work-time">${w.start}-${w.end}${w.note ? ' · ' + escapeHtml(w.note) : ''}</div>` : ''}
              <div class="work-resize-handle" data-resize-work="${w.id}" title="上下拖拉调整时长"></div>
            </div>`;
        });
      }

      return `<div class="day-col ${isTd ? 'today-col' : ''}" data-col-date="${ds}" style="height:${canvasHeight}px">${colInner}</div>`;
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
        const { activeList } = getEffectiveCoursesForDate(ds, homeroomOn ? 'class' : 'my');
        const visibleCourses = showEvening
          ? activeList
          : activeList.filter(c => toMin(c.start) < 18 * 60);
        const works = homeroomOn
          ? []
          : (appState.data.works || []).filter(wk => !wk.deleted && wk.date === ds && (showEvening || toMin(wk.start) < 18 * 60));

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
          works.slice(0, 2).forEach(wk => {
            pills.push(`<div class="month-pill work ${wk.urgent ? 'urgent' : ''}">${wk.start} ${escapeHtml(wk.title)}</div>`);
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

        cells.push(`
          <div class="month-cell ${d.getMonth() !== m ? 'other-month' : ''} ${isTd ? 'today' : ''}" data-month-date="${ds}">
            <div class="month-cell-top">
              <span>${d.getDate()}日</span>
              <span style="font-size:10px;color:${isTd ? 'var(--apple-blue)' : 'var(--text-muted)'};">${isTd ? '今天' : `${visibleCourses.length}课${works.length ? '·' + works.length + '活' : ''}`}</span>
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
      el.addEventListener('dblclick', () => {
        anchorDate = parseDate(el.dataset.headerDate);
        currentView = currentView === 'day' ? 'week' : 'day';
        render();
      });
    });

    document.querySelectorAll('[data-ghost-ov]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const source = el.dataset.ghostSource || 'my';
        const ovId = el.dataset.ghostOv;
        const ovList = source === 'class' ? (appState.data.classTimetable?.overrides || []) : (appState.data.overrides || []);
        const cList = source === 'class' ? (appState.data.classTimetable?.courses || []) : (appState.data.timetable?.courses || []);
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
        if (w) { w.done = !w.done; w.updatedAt = Date.now(); render(); await persistAndScheduleSync(); }
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
    let targetDate = null;
    let targetStartStr = null;
    let targetEndStr = null;

    function clearVisuals() {
      if (previewEl) { previewEl.remove(); previewEl = null; }
      if (magnetGlowEl) { magnetGlowEl.remove(); magnetGlowEl = null; }
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

      // 底层课程启用「🧲 节次磁吸」（按住 Alt 键可临时解除磁吸自由拖放）
      const useMagnet = (kind === 'course') && (appState.config.ui.magnetSnap !== false) && !ev.altKey;
      let snappedPeriod = useMagnet ? snapToNearestPeriod(rawCenter, range) : null;

      let sMin, eMin, label;
      if (snappedPeriod) {
        sMin = toMin(snappedPeriod.start);
        eMin = toMin(snappedPeriod.end);
        targetStartStr = snappedPeriod.start;
        targetEndStr = snappedPeriod.end;
        label = `🧲 磁吸 ${snappedPeriod.label} · ${targetStartStr}-${targetEndStr}`;
      } else {
        sMin = Math.max(range.start, Math.min(range.end - durMin, Math.round(rawStart / 5) * 5));
        eMin = sMin + durMin;
        targetStartStr = fromMin(sMin);
        targetEndStr = fromMin(eMin);
        label = `${kind === 'course' ? '🔄 调课至' : '📌 移至'} ${targetDate.slice(5)} ${targetStartStr}-${targetEndStr}`;
      }

      if (previewEl && previewEl.parentElement !== hoveredCol) clearVisuals();

      if (snappedPeriod) {
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
      previewEl.style.top = `${(sMin - range.start) * PX_PER_MIN}px`;
      previewEl.style.height = `${Math.max(24, (eMin - sMin) * PX_PER_MIN)}px`;
      previewEl.textContent = label;
    }

    async function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      blockEl.classList.remove('dragging');
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

  async function applySingleCourseMove(params) {
    const now = Date.now();
    const isClass = params.source === 'class';
    if (isClass && !appState.data.classTimetable.overrides) appState.data.classTimetable.overrides = [];
    const list = isClass ? appState.data.classTimetable.overrides : appState.data.overrides;

    if (params.targetDate === params.origDate && params.targetStart === params.origStart && params.targetEnd === params.origEnd) {
      if (params.overrideId) {
        const existing = list.find(o => o.id === params.overrideId);
        if (existing) { existing.deleted = true; existing.updatedAt = now; }
      }
      render(); await persistAndScheduleSync();
      showToast('已恢复到原定上课节次');
      return;
    }

    let ov = params.overrideId
      ? list.find(o => o.id === params.overrideId)
      : list.find(o => o.courseId === params.courseId && o.origDate === params.origDate);

    if (!ov) {
      list.push({
        id: uid('ov'), courseId: params.courseId, origDate: params.origDate,
        origStart: params.origStart, origEnd: params.origEnd, type: 'move',
        targetDate: params.targetDate, targetStart: params.targetStart, targetEnd: params.targetEnd,
        title: params.title, note: params.note || '', updatedAt: now, deleted: false,
      });
    } else {
      Object.assign(ov, {
        type: 'move', targetDate: params.targetDate, targetStart: params.targetStart, targetEnd: params.targetEnd,
        title: params.title, note: params.note || '', deleted: false, updatedAt: now,
      });
    }

    render(); await persistAndScheduleSync();
    showToast(`单次调课成功：已磁吸至 ${params.targetDate.slice(5)} ${params.targetStart}-${params.targetEnd}`);
  }

  // ===== 弹窗逻辑 =====
  function openRescheduleModal(ctx) {
    activeRescheduleCtx = ctx;
    const isClass = ctx.source === 'class';
    document.getElementById('rs-modal-title').textContent = isClass ? '🔄 班级课表单次调课 / 停课' : '🔄 个人课表单次调课 / 停课';
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
    const w = workId ? appState.data.works.find(x => x.id === workId) : null;
    document.getElementById('wk-modal-title').textContent = w ? '✏️ 编辑顶层干活事项' : '📌 添加顶层干活事项';
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
    setTimeout(() => document.getElementById('wk-title').focus(), 30);
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
      return;
    }

    const isClass = activeTtTab === 'class';
    document.getElementById('tt-meta-my').style.display = isClass ? 'none' : 'flex';
    document.getElementById('tt-meta-class').style.display = isClass ? 'flex' : 'none';
    document.getElementById('tt-term-start').value = appState.data.timetable.termStartDate || '2026-09-01';
    document.getElementById('tt-class-name').value = appState.data.classTimetable?.className || '902班';

    const pSel = document.getElementById('tt-add-period');
    pSel.innerHTML = `<option value="">选节次自动填时</option>` +
      getPeriods().map((p, idx) => `<option value="${idx}">${p.label} ${p.start}</option>`).join('');

    const rawList = isClass ? (appState.data.classTimetable?.courses || []) : (appState.data.timetable?.courses || []);
    const list = rawList.filter(c => !c.deleted).sort((a, b) => a.weekday - b.weekday || toMin(a.start) - toMin(b.start));
    const parityText = { all: '每周', odd: '单周', even: '双周' };
    const tbody = document.getElementById('tt-course-tbody');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:18px;">暂无课程，可点击上方「📥 导入 Excel / Word (.docx) 自动编排」</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(c => `
      <tr>
        <td>${WEEKDAYS_ISO[c.weekday]}</td>
        <td>${c.start} - ${c.end}</td>
        <td><strong>${escapeHtml(c.title)}</strong></td>
        <td>${parityText[c.parity || 'all']}</td>
        <td><button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" data-del-course="${c.id}">删除</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-del-course]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const c = rawList.find(x => x.id === btn.dataset.delCourse);
        if (c) { c.deleted = true; c.updatedAt = Date.now(); renderTimetableManager(); render(); await persistAndScheduleSync(); }
      });
    });
  }

  function switchSettingsTab(tab) {
    activeSettingsTab = tab || 'sync';
    document.querySelectorAll('[data-set-tab]').forEach(b => b.classList.toggle('active', b.dataset.setTab === activeSettingsTab));
    ['sync', 'update', 'desktop'].forEach(t => {
      const el = document.getElementById(`set-panel-${t}`);
      if (el) el.style.display = t === activeSettingsTab ? 'flex' : 'none';
    });
  }

  async function openSettingsModal(tab = 'sync') {
    const cfg = appState.config.webdav, ui = appState.config.ui;
    const uCfg = appState.config.updater || {};
    document.getElementById('dav-url').value = cfg.serverUrl || 'https://dav.jianguoyun.com/dav/';
    document.getElementById('dav-user').value = cfg.username || '2465179479@qq.com';
    document.getElementById('dav-folder').value = cfg.folder || 'TeacherCal';
    document.getElementById('dav-pass').value = cfg.password || '';
    document.getElementById('dav-auto').checked = cfg.autoSync !== false;
    document.getElementById('dav-test-result').classList.add('hidden');

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
    const menuBtn = document.getElementById('btn-main-menu');
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

  // ===== 图 3 / 图 4 菜单支撑功能：搜索、便签管理、AI 排程、自动周报 =====
  function closeAllMenus() {
    document.getElementById('menu-plugin')?.classList.add('hidden');
    document.getElementById('menu-main')?.classList.add('hidden');
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
    const classCourses = (appState.data.classTimetable?.courses || []).filter(c => !c.deleted);
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
    classCourses.forEach(c => {
      if (kw && c.title.toLowerCase().includes(kw)) {
        const mon = getMondayOf(anchorDate);
        const dStr = fmtDate(addDays(mon, (c.weekday || 1) - 1));
        items.push({ kind: '🏫 班级课', title: c.title, sub: `${WEEKDAYS_ISO[c.weekday]} ${c.start}-${c.end}`, date: dStr });
      }
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
    const list = (appState.data.works || [])
      .filter(w => !w.deleted)
      .filter(w => memoMgrFilter === 'all' ? true : (memoMgrFilter === 'done' ? w.done : !w.done))
      .sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start));
    const box = document.getElementById('memo-mgr-list');
    if (!list.length) {
      box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:18px;">当前筛选下暂无便签/干活记录</div>';
      return;
    }
    box.innerHTML = list.map(w => `
      <div class="mgr-row">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
          <button class="btn" style="padding:2px 7px;" data-mm-toggle="${w.id}">${w.done ? '☑' : '☐'}</button>
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;${w.done ? 'text-decoration:line-through;opacity:0.6;' : ''}">${w.urgent ? '🔴 ' : ''}${escapeHtml(w.title)}</div>
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
      if (w) { w.done = !w.done; w.updatedAt = Date.now(); renderMemoMgrList(); render(); await persistAndScheduleSync(); }
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
    if (/今天|今日/.test(text)) { targetDate = fmtDate(now); text = text.replace(/今天|今日/g, ''); }
    else if (/明天|明日/.test(text)) { targetDate = fmtDate(addDays(now, 1)); text = text.replace(/明天|明日/g, ''); }
    else if (/后天/.test(text)) { targetDate = fmtDate(addDays(now, 2)); text = text.replace(/后天/g, ''); }
    else {
      const wdMatch = text.match(/(?:星期|周)([一二三四五六日天])/);
      if (wdMatch) {
        const wdMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
        const mon = getMondayOf(anchorDate);
        targetDate = fmtDate(addDays(mon, wdMap[wdMatch[1]] - 1));
        text = text.replace(wdMatch[0], '');
      }
      const dateMatch = text.match(/(\d{1,2})[月/-](\d{1,2})日?/);
      if (dateMatch) {
        targetDate = `${now.getFullYear()}-${pad2(Number(dateMatch[1]))}-${pad2(Number(dateMatch[2]))}`;
        text = text.replace(dateMatch[0], '');
      }
    }

    let start = '09:00', end = '10:00';
    const rangeM = text.match(/(\d{1,2})[:：.](\d{2})\s*[-~—到至]\s*(\d{1,2})[:：.](\d{2})/);
    if (rangeM) {
      start = `${pad2(Number(rangeM[1]))}:${rangeM[2]}`;
      end = `${pad2(Number(rangeM[3]))}:${rangeM[4]}`;
      text = text.replace(rangeM[0], '');
    } else {
      const cnTimeM = text.match(/(上午|下午|晚上)?\s*(\d{1,2})点(?:(\d{1,2})分?|半)?\s*(?:[-~—到至]\s*(上午|下午|晚上)?\s*(\d{1,2})点(?:(\d{1,2})分?|半)?)?/);
      if (cnTimeM) {
        const to24 = (ap, hStr, mStr, halfStr) => {
          let h = Number(hStr);
          if ((ap === '下午' || ap === '晚上') && h < 12) h += 12;
          const m = halfStr === '半' ? 30 : (mStr ? Number(mStr) : 0);
          return h * 60 + m;
        };
        const sM = to24(cnTimeM[1], cnTimeM[2], cnTimeM[3], cnTimeM[0].includes('点半') && !cnTimeM[5] ? '半' : '');
        start = fromMin(sM);
        if (cnTimeM[5]) {
          const ap2 = cnTimeM[4] || cnTimeM[1];
          const tail = cnTimeM[0].split(/[-~—到至]/)[1] || '';
          const eM = to24(ap2, cnTimeM[5], cnTimeM[6], tail.includes('半') ? '半' : '');
          end = fromMin(Math.max(sM + 15, eM));
        } else {
          end = fromMin(sM + 60);
        }
        text = text.replace(cnTimeM[0], '');
      }
    }

    const urgent = /重要|紧急|加急/.test(text);
    const title = text.replace(/重要|紧急|加急/g, '').replace(/\s+/g, ' ').trim() || '临时工作事项';
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

  // ===== 双击最左侧时间轴：智能批量排作息时间 =====
  let bellBatchDraft = [];

  function formatGapDuration(mins) {
    if (mins <= 0) return '紧接下节';
    if (mins >= 60) {
      const h = Math.floor(mins / 60), m = mins % 60;
      return m ? `${h}小时${m}分` : `${h}小时`;
    }
    return `${mins}分钟`;
  }

  function openBellBatchModal() {
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
      cursor = e + (i === bigAfter ? bigDur : breakDur);
    }

    const amLastEnd = list.length ? toMin(list[list.length - 1].end) : amStart;
    const noonGap = Math.max(0, pmStart - amLastEnd);
    document.getElementById('bell-noon-badge').textContent = pmCount > 0
      ? `🍱 中午休息：${formatGapDuration(noonGap)}（${fromMin(amLastEnd)} → ${fromMin(pmStart)}）`
      : '无下午课程';

    cursor = pmStart;
    for (let i = 1; i <= pmCount; i++) {
      const s = cursor, e = s + classDur;
      list.push({ num: list.length + 1, label: `第${amCount + i}节`, start: fromMin(s), end: fromMin(e) });
      cursor = e + breakDur;
    }

    const evDur = Math.max(30, Math.min(60, classDur + 5));
    cursor = evStart;
    for (let i = 1; i <= evCount; i++) {
      const s = cursor, e = s + evDur;
      list.push({ num: list.length + 1, label: `晚自习${i}`, start: fromMin(s), end: fromMin(e) });
      cursor = e + 10;
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
          gapLabel = `🍽 晚休 ${formatGapDuration(gap)}`;
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
    const className = appState.data.classTimetable?.className || '902班';
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
    const targetArr = activeImportTarget === 'class'
      ? appState.data.classTimetable.courses
      : appState.data.timetable.courses;

    // 软删除旧课表并写入自动分配好的新课表
    targetArr.forEach(c => { c.deleted = true; c.updatedAt = now; });
    targetArr.push(...res.courses);

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

  function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
  function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

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
    document.getElementById('topbar-full-date').addEventListener('click', () => {
      anchorDate = new Date();
      render();
      showToast('已回到今天');
    });

    // 顶部极简图标区：插件(图4)、手机、云同步、账户、主菜单(图3)
    document.getElementById('btn-plugin-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdownMenu('menu-plugin', e.currentTarget);
    });
    document.getElementById('btn-main-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdownMenu('menu-main', e.currentTarget);
    });
    document.getElementById('btn-phone-quick').addEventListener('click', () => openSettingsModal('desktop'));
    document.getElementById('btn-cloud-icon').addEventListener('click', () => openSettingsModal('sync'));
    document.getElementById('btn-account-icon').addEventListener('click', () => openSettingsModal('sync'));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-menu') && !e.target.closest('#btn-plugin-menu') && !e.target.closest('#btn-main-menu')) {
        closeAllMenus();
      }
    });

    // 图 4：插件下拉菜单动作绑定
    document.querySelectorAll('[data-plugin-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.pluginAct;
        closeAllMenus();
        if (act === 'desktop-mgr') openSettingsModal('desktop');
        else if (act === 'new-memo') {
          if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
          openWorkModal(null);
        } else if (act === 'memo-settings') {
          if (appState.config.ui.homeroomMode) await setHomeroomMode(false);
          openSettingsModal('theme');
        } else if (act === 'memo-mgr') {
          renderMemoMgrList();
          openModal('modal-memo-mgr');
        } else if (act === 'new-schedule') {
          openSmartImportModal(appState.config.ui.homeroomMode ? 'class' : 'my');
        } else if (act === 'schedule-mgr') {
          activeTtTab = appState.config.ui.homeroomMode ? 'class' : 'my';
          renderTimetableManager();
          openModal('modal-timetable');
        } else if (act === 'ai-platform') {
          document.getElementById('ai-parse-preview').classList.add('hidden');
          openModal('modal-ai-platform');
        } else if (act === 'weekly-report') {
          document.getElementById('wr-content').value = generateWeeklyReportText();
          openModal('modal-weekly-report');
        }
      });
    });

    // 图 3：设置主菜单动作绑定
    document.querySelectorAll('[data-main-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.mainAct;
        closeAllMenus();
        if (act === 'search') openSearchModal(false);
        else if (act === 'pick-date') openSearchModal(true);
        else if (act === 'theme') openSettingsModal('theme');
        else if (act === 'resize-unlock') {
          if (isUiLocked) {
            applyLockUi(false);
            appState.config.ui.locked = false;
            await window.SyncBridge.setDesktopOptions({ locked: false });
            await persistAndScheduleSync(false);
          }
          showToast('已解锁，可拖动顶部移动窗口、拖动四边任意调整长宽高');
        } else if (act === 'hide-window') {
          await window.SyncBridge.windowAction('hide');
        } else if (act === 'privacy-mask') {
          isPrivacyMasked = !isPrivacyMasked;
          document.body.classList.toggle('privacy-masked', isPrivacyMasked);
          document.getElementById('menu-privacy-flag').textContent = isPrivacyMasked ? '🔒' : '🔓';
          showToast(isPrivacyMasked ? '🔒 已开启隐私保护：日历内容已模糊隐藏' : '🔓 已恢复显示日历内容');
        } else if (act === 'export') {
          exportAllJsonBackup();
        } else if (act === 'import') {
          openSmartImportModal(appState.config.ui.homeroomMode ? 'class' : 'my');
        } else if (act === 'print') {
          window.print();
        } else if (act === 'cal-settings') {
          openSettingsModal('desktop');
        } else if (act === 'account-settings') {
          openSettingsModal('sync');
        } else if (act === 'features') {
          openModal('modal-features');
        } else if (act === 'about-update') {
          openSettingsModal('update');
        } else if (act === 'quit') {
          await window.SyncBridge.windowAction('quit');
        }
      });
    });

    // 3 档主题切换：白天 / 黑夜 / 自动识别
    document.querySelectorAll('[data-theme-mode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        appState.config.ui.theme = btn.dataset.themeMode;
        render();
        await persistAndScheduleSync(false);
      });
    });
    if (darkMediaQuery && darkMediaQuery.addEventListener) {
      darkMediaQuery.addEventListener('change', () => {
        if (appState?.config?.ui?.theme === 'auto') render();
      });
    }

    // 互斥「班主任班级课表」勾选逻辑 + 横幅内三合一智能导入按钮
    document.getElementById('chk-homeroom').addEventListener('change', (e) => setHomeroomMode(e.target.checked));
    document.getElementById('btn-exit-homeroom').addEventListener('click', () => setHomeroomMode(false));
    document.getElementById('btn-homeroom-smart-import').addEventListener('click', () => openSmartImportModal('class'));

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
      appState.config.ui.bgAlpha = Number(document.getElementById('rng-bg-alpha').value);
      const setSlider = document.getElementById('rng-bg-alpha-set');
      if (setSlider) setSlider.value = appState.config.ui.bgAlpha;
      render(); await persistAndScheduleSync(false);
    };
    ['chk-magnet', 'rng-course-opacity', 'rng-work-opacity', 'rng-bg-alpha'].forEach(id => {
      document.getElementById(id).addEventListener('input', saveSimpleUi);
    });
    const bgAlphaSetEl = document.getElementById('rng-bg-alpha-set');
    if (bgAlphaSetEl) {
      bgAlphaSetEl.addEventListener('input', async (e) => {
        appState.config.ui.bgAlpha = Number(e.target.value);
        document.getElementById('rng-bg-alpha').value = appState.config.ui.bgAlpha;
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
      showToast('已解析并添加到顶层干活图层');
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

    // 三合一智能导入弹窗内卡片点击
    document.querySelectorAll('[data-import-kind]').forEach(btn => {
      btn.addEventListener('click', () => executeSmartImport(btn.dataset.importKind));
    });
    document.getElementById('btn-si-any').addEventListener('click', () => executeSmartImport('auto'));

    // 双击最左侧时间轴 -> 智能批量排作息弹窗事件
    ['bb-class-dur', 'bb-break-dur', 'bb-big-after', 'bb-big-dur', 'bb-am-start', 'bb-am-count', 'bb-pm-start', 'bb-pm-count', 'bb-ev-start', 'bb-ev-count'].forEach(id => {
      document.getElementById(id).addEventListener('input', recalcBellBatchDraft);
    });
    document.querySelectorAll('[data-bell-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
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
        remapCoursesByPeriods(appState.data.classTimetable?.courses || [], oldPeriods, newPeriods, now);
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
    document.getElementById('btn-unlock-banner').addEventListener('click', toggleLock);

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

    document.getElementById('btn-rs-save').addEventListener('click', async () => {
      if (!activeRescheduleCtx) return;
      const targetDate = document.getElementById('rs-target-date').value;
      const targetStart = document.getElementById('rs-target-start').value;
      const targetEnd = document.getElementById('rs-target-end').value;
      if (!targetDate || !targetStart || !targetEnd || toMin(targetEnd) <= toMin(targetStart)) {
        showToast('请填写正确的目标日期和起止时间'); return;
      }
      closeModal('modal-reschedule');
      await applySingleCourseMove({
        ...activeRescheduleCtx,
        title: document.getElementById('rs-title').value.trim() || activeRescheduleCtx.title,
        note: document.getElementById('rs-note').value.trim(),
        targetDate, targetStart, targetEnd,
      });
    });

    document.getElementById('btn-rs-cancel-once').addEventListener('click', async () => {
      if (!activeRescheduleCtx) return;
      const now = Date.now();
      const isClass = activeRescheduleCtx.source === 'class';
      const list = isClass ? appState.data.classTimetable.overrides : appState.data.overrides;
      let ov = activeRescheduleCtx.overrideId
        ? list.find(o => o.id === activeRescheduleCtx.overrideId)
        : list.find(o => o.courseId === activeRescheduleCtx.courseId && o.origDate === activeRescheduleCtx.origDate);
      if (!ov) {
        list.push({ id: uid('ov'), courseId: activeRescheduleCtx.courseId, origDate: activeRescheduleCtx.origDate, origStart: activeRescheduleCtx.origStart, origEnd: activeRescheduleCtx.origEnd, type: 'cancel', title: activeRescheduleCtx.title, updatedAt: now, deleted: false });
      } else { ov.type = 'cancel'; ov.deleted = false; ov.updatedAt = now; }
      closeModal('modal-reschedule'); render(); await persistAndScheduleSync();
      showToast('已标记为单次停课');
    });

    document.getElementById('btn-rs-restore').addEventListener('click', async () => {
      if (!activeRescheduleCtx?.overrideId) return;
      const isClass = activeRescheduleCtx.source === 'class';
      const list = isClass ? appState.data.classTimetable.overrides : appState.data.overrides;
      const ov = list.find(o => o.id === activeRescheduleCtx.overrideId);
      if (ov) { ov.deleted = true; ov.updatedAt = Date.now(); }
      closeModal('modal-reschedule'); render(); await persistAndScheduleSync();
      showToast('已恢复原课表');
    });

    // 顶层干活弹窗
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

    // 课表与作息管理弹窗
    document.querySelectorAll('[data-tt-tab]').forEach(btn => {
      btn.addEventListener('click', () => { activeTtTab = btn.dataset.ttTab; renderTimetableManager(); });
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
    document.getElementById('tt-class-name').addEventListener('change', async (e) => {
      appState.data.classTimetable.className = e.target.value.trim() || '902班';
      appState.data.classTimetable.metaUpdatedAt = Date.now();
      render(); await persistAndScheduleSync();
    });
    document.getElementById('btn-tt-add').addEventListener('click', async () => {
      const weekday = Number(document.getElementById('tt-add-day').value);
      const start = document.getElementById('tt-add-start').value, end = document.getElementById('tt-add-end').value;
      const title = document.getElementById('tt-add-title').value.trim();
      if (!title || toMin(end) <= toMin(start)) { showToast('请输入课程名称与正确起止时间'); return; }
      const targetArr = activeTtTab === 'class' ? appState.data.classTimetable.courses : appState.data.timetable.courses;
      targetArr.push({ id: uid(activeTtTab === 'class' ? 'cc' : 'c'), weekday, start, end, title, room: '', parity: 'all', color: guessColor(title), updatedAt: Date.now(), deleted: false });
      document.getElementById('tt-add-title').value = '';
      renderTimetableManager(); render(); await persistAndScheduleSync();
    });
    document.getElementById('btn-tt-clear').addEventListener('click', async () => {
      const now = Date.now();
      const targetArr = activeTtTab === 'class' ? appState.data.classTimetable.courses : appState.data.timetable.courses;
      targetArr.forEach(c => { c.deleted = true; c.updatedAt = now; });
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
      window.desktopApi.onStateUpdated((next) => { appState = next; render(); });
      window.desktopApi.onLockChanged((locked) => { applyLockUi(locked); });
    }
  }

  async function init() {
    bindGlobalEvents();
    appState = await window.SyncBridge.loadState();
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

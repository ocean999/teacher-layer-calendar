const XLSX = require('xlsx');
const yauzl = require('yauzl');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// 默认学校作息节次（每节 40 分钟，课间 15 分钟）
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
  { num: 11, label: '晚自习3', start: '20:20', end: '21:05' },
];

const WEEKDAY_MAP = {
  '周一': 1, '星期一': 1, '一': 1, 'mon': 1, 'monday': 1, '1': 1,
  '周二': 2, '星期二': 2, '二': 2, 'tue': 2, 'tuesday': 2, '2': 2,
  '周三': 3, '星期三': 3, '三': 3, 'wed': 3, 'wednesday': 3, '3': 3,
  '周四': 4, '星期四': 4, '四': 4, 'thu': 4, 'thursday': 4, '4': 4,
  '周五': 5, '星期五': 5, '五': 5, 'fri': 5, 'friday': 5, '5': 5,
  '周六': 6, '星期六': 6, '六': 6, 'sat': 6, 'saturday': 6, '6': 6,
  '周日': 7, '周天': 7, '星期日': 7, '星期天': 7, '日': 7, 'sun': 7, 'sunday': 7, '7': 7,
};

function toMin(t) {
  const [h, m] = String(t || '08:00').split(':').map(Number);
  return h * 60 + m;
}

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

function parseWeekday(val) {
  const s = String(val || '').replace(/\s+/g, '').trim().toLowerCase();
  if (WEEKDAY_MAP[s]) return WEEKDAY_MAP[s];
  for (const [k, v] of Object.entries(WEEKDAY_MAP)) {
    if (k.length >= 2 && s.includes(k)) return v;
  }
  return null;
}

function normalizeTime(t) {
  const m = String(t || '').trim().match(/(\d{1,2})\s*[:：.]\s*(\d{2})/);
  if (!m) return null;
  const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseTimeRange(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const m = s.match(/(\d{1,2}[:：.]\d{2})[-~—–一至到](\d{1,2}[:：.]\d{2})/);
  if (!m) return null;
  const start = normalizeTime(m[1]);
  const end = normalizeTime(m[2]);
  if (start && end && toMin(end) > toMin(start)) return { start, end };
  return null;
}

function parseWeekParity(text) {
  const s = String(text || '');
  if (/单周|单/.test(s) && !/双/.test(s)) return 'odd';
  if (/双周|双/.test(s) && !/单/.test(s)) return 'even';
  return 'all';
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

// ===== 1. Word (.docx) 表格提取 =====
function extractDocxTables(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(new Error(`无法打开 Word 文件：${err.message}`));
      let found = false;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'word/document.xml') {
          found = true;
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2) return reject(err2);
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => {
              const xml = Buffer.concat(chunks).toString('utf8');
              zipfile.close();
              resolve(parseWordXmlToRows(xml));
            });
            stream.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => {
        if (!found) reject(new Error('该 .docx 文件中未找到正文内容（word/document.xml）。'));
      });
      zipfile.on('error', reject);
    });
  });
}

function parseWordXmlToRows(xml) {
  const tables = xml.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) || [];
  const allRows = [];
  for (const tbl of tables) {
    const trList = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    for (const tr of trList) {
      const tcList = tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      const row = tcList.map((tc) => {
        const paras = tc.match(/<w:p[\s\S]*?<\/w:p>/g) || [tc];
        const lines = paras.map((p) => {
          const texts = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
          return texts.map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, ''))).join('');
        }).filter((s) => s.trim());
        return lines.join(' ').trim();
      });
      if (row.some((c) => c)) allRows.push(row);
    }
  }
  return allRows;
}

// ===== 2. 拍照 / 截图 OCR 识别并重建二维课表 =====
function runWindowsOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'ocr-timetable.ps1');
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', imagePath],
      { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`拍照 OCR 识别失败：${stderr || err.message}`));
        try {
          const data = JSON.parse(stdout.trim());
          resolve(data);
        } catch (e) {
          reject(new Error(`OCR 输出解析失败：${e.message}`));
        }
      }
    );
  });
}

function ocrLinesToGridRows(ocrData) {
  const lines = (ocrData && ocrData.lines) || [];
  if (!lines.length) throw new Error('图片中未识别到文字，请确保课表照片清晰、光线充足。');

  // 找到表头中的星期标签（周一~周日）以及它们的水平中心坐标 X
  const dayAnchors = [];
  for (const item of lines) {
    const txt = String(item.text || '').replace(/\s+/g, '');
    // 如果一行里同时包含多个星期（如 "周一 周二 周三 周四 周五"），按等分拆分锚点
    const multiMatches = [...txt.matchAll(/(星期[一二三四五六日天]|周[一二三四五六日天])/g)];
    if (multiMatches.length >= 3) {
      const step = item.w / multiMatches.length;
      multiMatches.forEach((m, idx) => {
        const wd = parseWeekday(m[1]);
        if (wd) {
          dayAnchors.push({ wd, label: m[1], cx: item.x + step * (idx + 0.5), y: item.y, h: item.h });
        }
      });
    } else if (multiMatches.length === 1 && txt.length <= 6) {
      const wd = parseWeekday(multiMatches[0][1]);
      if (wd) dayAnchors.push({ wd, label: multiMatches[0][1], cx: item.x + item.w / 2, y: item.y, h: item.h });
    }
  }

  // 去重并按 X 排序；若识别到 >=2 个星期列，自动按等距插值/外推补全缺失的周一~周五列
  const uniqMap = new Map();
  for (const a of dayAnchors) {
    if (!uniqMap.has(a.wd)) uniqMap.set(a.wd, a);
  }
  let anchors = Array.from(uniqMap.values()).sort((a, b) => a.cx - b.cx);
  if (anchors.length >= 2 && anchors.length < 5) {
    const first = anchors[0], last = anchors[anchors.length - 1];
    if (last.wd > first.wd) {
      const step = (last.cx - first.cx) / (last.wd - first.wd);
      const maxWd = Math.max(5, last.wd);
      const full = [];
      for (let wd = 1; wd <= maxWd; wd++) {
        if (uniqMap.has(wd)) full.push(uniqMap.get(wd));
        else full.push({ wd, label: `周${['','一','二','三','四','五','六','日'][wd]}`, cx: first.cx + (wd - first.wd) * step, y: first.y, h: first.h });
      }
      anchors = full;
    }
  }
  if (anchors.length < 3) {
    throw new Error('照片中未能定位到“周一~周五”表头列，请尽量拍全整张课表表头后再试。');
  }

  const headerY = anchors.reduce((acc, a) => acc + a.y, 0) / anchors.length;
  const avgH = Math.max(14, lines.reduce((acc, l) => acc + (l.h || 18), 0) / lines.length);

  // 过滤掉表头上方标题，按 Y 坐标聚类成行
  const bodyItems = lines
    .filter((l) => l.y > headerY + avgH * 0.45)
    .sort((a, b) => a.y - b.y);

  const rowBuckets = [];
  for (const item of bodyItems) {
    const cy = item.y + item.h / 2;
    const targetBucket = rowBuckets.find((b) => Math.abs(b.cy - cy) <= avgH * 1.15);
    if (targetBucket) {
      targetBucket.items.push(item);
      targetBucket.cy = targetBucket.items.reduce((s, it) => s + it.y + it.h / 2, 0) / targetBucket.items.length;
    } else {
      rowBuckets.push({ cy, items: [item] });
    }
  }

  // 计算时间列分界线（比周一中心靠左半个列宽以内视为左侧时间/节次列）
  const colStep = anchors.length > 1 ? (anchors[anchors.length - 1].cx - anchors[0].cx) / (anchors.length - 1) : 120;
  const timeBoundaryX = anchors[0].cx - colStep * 0.48;

  const gridRows = [];
  gridRows.push(['节次 / 时间', ...anchors.map((a) => a.label)]);

  for (const b of rowBuckets) {
    const rowArr = new Array(1 + anchors.length).fill('');
    for (const item of b.items.sort((a, c) => a.x - c.x)) {
      const cx = item.x + item.w / 2;
      const clean = String(item.text || '').replace(/([\u4e00-\u9fa5\d：:一-])\s+(?=[\u4e00-\u9fa5\d：:一-])/g, '$1').trim();
      if (!clean) continue;
      if (cx < timeBoundaryX || parseTimeRange(clean)) {
        rowArr[0] = (rowArr[0] + ' ' + clean).trim();
      } else {
        // 找水平中心最近的星期列
        let bestIdx = 0, bestDist = Infinity;
        anchors.forEach((a, idx) => {
          const d = Math.abs(cx - a.cx);
          if (d < bestDist) { bestDist = d; bestIdx = idx; }
        });
        rowArr[1 + bestIdx] = (rowArr[1 + bestIdx] + ' ' + clean).trim();
      }
    }
    if (rowArr.some((c) => c)) gridRows.push(rowArr);
  }

  return gridRows;
}

// ===== 3. 从识别结果中自动提取并整理作息节次表（供最左侧时间轴自动校准） =====
function extractDetectedPeriods(courses, explicitPeriodMap) {
  const slotMap = new Map();
  for (const [key, val] of explicitPeriodMap.entries()) {
    slotMap.set(key, val);
  }
  for (const c of courses) {
    const key = `${c.start}-${c.end}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, { start: c.start, end: c.end, label: '' });
    }
  }

  const sorted = Array.from(slotMap.values()).sort((a, b) => toMin(a.start) - toMin(b.start));
  let dayIdx = 0;
  let nightIdx = 0;
  return sorted.map((p, i) => {
    const isNight = toMin(p.start) >= 18 * 60;
    let label = p.label;
    if (!label) {
      if (isNight) { nightIdx++; label = `晚自习${nightIdx}`; }
      else { dayIdx++; label = `第${dayIdx}节`; }
    }
    return { num: i + 1, label, start: p.start, end: p.end };
  });
}

// ===== 4. 统一二维行表解析器（Excel / Word / 拍照 OCR 共用） =====
function parseRowsToCourses(rows, currentPeriods = DEFAULT_PERIODS) {
  const now = Date.now();
  const courses = [];
  const periods = (currentPeriods && currentPeriods.length) ? currentPeriods : DEFAULT_PERIODS;
  const explicitPeriodMap = new Map();

  // 策略 1：清单格式（星期 / 开始时间 / 结束时间 / 课程名称）
  let listHeaderIdx = -1;
  let colMap = {};
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = (rows[r] || []).map((c) => String(c || '').trim());
    const idxDay = row.findIndex((c) => /星期|周几|礼拜/.test(c));
    const idxStart = row.findIndex((c) => /开始|起始/.test(c));
    const idxEnd = row.findIndex((c) => /结束|终止/.test(c));
    const idxTitle = row.findIndex((c) => /课程|科目|名称|班级|内容/.test(c));
    const idxParity = row.findIndex((c) => /单双|周次/.test(c));
    const idxRoom = row.findIndex((c) => /地点|教室|老师|教师|备注/.test(c));
    if (idxDay !== -1 && idxStart !== -1 && idxTitle !== -1) {
      listHeaderIdx = r;
      colMap = { idxDay, idxStart, idxEnd, idxTitle, idxParity, idxRoom };
      break;
    }
  }

  if (listHeaderIdx !== -1) {
    for (let r = listHeaderIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => !String(c || '').trim())) continue;
      const weekday = parseWeekday(row[colMap.idxDay]);
      const start = normalizeTime(row[colMap.idxStart]);
      let end = colMap.idxEnd !== -1 ? normalizeTime(row[colMap.idxEnd]) : null;
      const title = String(row[colMap.idxTitle] || '').trim();
      if (!weekday || !start || !title) continue;
      if (!end) {
        const tot = toMin(start) + 40;
        end = `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
      }
      explicitPeriodMap.set(`${start}-${end}`, { start, end, label: '' });
      const parity = colMap.idxParity !== -1 ? parseWeekParity(row[colMap.idxParity]) : parseWeekParity(title);
      const room = colMap.idxRoom !== -1 ? String(row[colMap.idxRoom] || '').trim() : '';
      courses.push({
        id: 'c_' + crypto.randomUUID().slice(0, 8),
        weekday, start, end,
        title: title.replace(/[（(]?(单周|双周)[)）]?/g, '').trim(),
        room, parity,
        color: guessColor(title),
        updatedAt: now, deleted: false,
      });
    }
    if (courses.length) {
      const detectedPeriods = extractDetectedPeriods(courses, explicitPeriodMap);
      return finalizeParseResult('list', courses, detectedPeriods);
    }
  }

  // 策略 2：二维网格课表（列为周一~周五/周日，行为第1节/08:00-08:40）
  let gridHeaderIdx = -1;
  const dayCols = {};
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r] || [];
    let found = 0;
    const temp = {};
    row.forEach((cell, cIdx) => {
      const wd = parseWeekday(cell);
      if (wd) { temp[cIdx] = wd; found++; }
    });
    if (found >= 3) {
      gridHeaderIdx = r;
      Object.assign(dayCols, temp);
      break;
    }
  }

  if (gridHeaderIdx !== -1) {
    let periodCounter = 0;
    for (let r = gridHeaderIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => !String(c || '').trim())) continue;

      const labelText = `${row[0] || ''} ${row[1] || ''}`.trim();
      const hasAnyCourse = Object.keys(dayCols).some((c) => {
        const v = String(row[Number(c)] || '').trim();
        return v && !/^[-—无空/]$/.test(v);
      });
      if (/午休|课间|眼保健操|大课间|午餐/.test(labelText) && !hasAnyCourse) continue;

      let range = parseTimeRange(labelText);
      let rowLabel = '';
      const labelMatch = labelText.match(/(第?\s*\d{1,2}\s*节|第?[一二三四五六七八九十]+节|早读|晚自习\d*)/);
      if (labelMatch) rowLabel = labelMatch[1].replace(/\s+/g, '');

      if (range) {
        explicitPeriodMap.set(`${range.start}-${range.end}`, { start: range.start, end: range.end, label: rowLabel });
      } else {
        const numMatch = labelText.match(/第?\s*(\d{1,2})\s*节?/);
        const cnMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
        const cnMatch = labelText.match(/第?\s*([一二三四五六七八九十])\s*节/);
        let pIdx = periodCounter;
        if (numMatch) pIdx = Number(numMatch[1]) - 1;
        else if (cnMatch && cnMap[cnMatch[1]]) pIdx = cnMap[cnMatch[1]] - 1;
        const p = periods[pIdx] || DEFAULT_PERIODS[pIdx];
        if (p) {
          range = { start: p.start, end: p.end };
          explicitPeriodMap.set(`${range.start}-${range.end}`, { start: range.start, end: range.end, label: rowLabel || p.label });
        }
      }
      periodCounter++;
      if (!range) continue;

      for (const [colStr, weekday] of Object.entries(dayCols)) {
        const raw = String(row[Number(colStr)] || '').trim();
        if (!raw || /^[-—无空/]$/.test(raw)) continue;
        const cleanTitle = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        courses.push({
          id: 'c_' + crypto.randomUUID().slice(0, 8),
          weekday,
          start: range.start,
          end: range.end,
          title: cleanTitle.replace(/[（(]?(单周|双周)[)）]?/g, '').trim(),
          room: '',
          parity: parseWeekParity(cleanTitle),
          color: guessColor(cleanTitle),
          updatedAt: now,
          deleted: false,
        });
      }
    }
    if (courses.length) {
      const detectedPeriods = extractDetectedPeriods(courses, explicitPeriodMap);
      return finalizeParseResult('grid', courses, detectedPeriods);
    }
  }

  throw new Error('未能识别课表结构。请确保文件中包含“周一~周五”表头，或“星期 / 开始时间 / 结束时间 / 课程名称”。');
}

function finalizeParseResult(format, courses, detectedPeriods) {
  const allStarts = courses.map((c) => toMin(c.start));
  const allEnds = courses.map((c) => toMin(c.end));
  const minStartMin = Math.min(...allStarts);
  const maxEndMin = Math.max(...allEnds);
  const hasEvening = maxEndMin > 18 * 60;
  const hasWeekend = courses.some((c) => c.weekday >= 6);
  return {
    format,
    courses,
    detectedPeriods,
    minStartMin,
    maxEndMin,
    hasEvening,
    hasWeekend,
  };
}

async function parseScheduleFile(filePath, currentPeriods = DEFAULT_PERIODS) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const rows = await extractDocxTables(filePath);
    if (!rows.length) throw new Error('该 Word 文档（.docx）中未检测到表格，请将课表整理在 Word 表格中再导入。');
    return parseRowsToCourses(rows, currentPeriods);
  }
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
    const ocr = await runWindowsOcr(filePath);
    const rows = ocrLinesToGridRows(ocr);
    const res = parseRowsToCourses(rows, currentPeriods);
    return { ...res, format: 'image-ocr' };
  }
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return parseRowsToCourses(rows, currentPeriods);
}

function exportTemplateXlsx(outPath) {
  const wb = XLSX.utils.book_new();
  const gridData = [
    ['节次 / 时间', '周一', '周二', '周三', '周四', '周五'],
    ['第1节 08:00-08:40', '902历史', '', '901历史', '', '903地理'],
    ['第2节 08:55-09:35', '', '903历史', '', '904道法', ''],
    ['第3节 09:50-10:30', '901道法', '', '', '', '902道法'],
    ['第4节 10:40-11:20', '', '902道法', '', '902历史', ''],
    ['第5节 13:30-14:10', '', '901历史', '902地理', '', ''],
    ['第6节 14:25-15:05', '904地理', '', '', '903地理', ''],
    ['第7节 15:20-16:00', '', '', '902班会', '', ''],
    ['晚自习1 18:30-19:15', '', '', '902晚自习', '', '902晚自习'],
  ];
  const wsGrid = XLSX.utils.aoa_to_sheet(gridData);
  wsGrid['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsGrid, '网格课表(含晚自习)');

  const classData = [
    ['节次 / 时间', '周一', '周二', '周三', '周四', '周五'],
    ['第1节 08:00-08:40', '历史(张)', '数学(陈)', '语文(林)', '英语(周)', '数学(陈)'],
    ['第2节 08:55-09:35', '语文(林)', '英语(周)', '数学(陈)', '科学(王)', '语文(林)'],
    ['第3节 09:50-10:30', '科学(王)', '语文(林)', '英语(周)', '数学(陈)', '道法(张)'],
    ['第4节 10:40-11:20', '数学(陈)', '道法(张)', '科学(王)', '历史(张)', '英语(周)'],
    ['第5节 13:30-14:10', '英语(周)', '体育(赵)', '地理(张)', '语文(林)', '科学(王)'],
    ['第6节 14:25-15:05', '美术(孙)', '科学(王)', '体育(赵)', '音乐(钱)', '信息(吴)'],
    ['第7节 15:20-16:00', '自习', '心理', '班会(张)', '自习', '社团'],
    ['晚自习1 18:30-19:15', '语文晚练', '数学晚练', '社政晚练', '英语晚练', '科学晚练'],
    ['晚自习2 19:25-20:10', '自主作业', '自主作业', '自主作业', '自主作业', '周清整理'],
  ];
  const wsClass = XLSX.utils.aoa_to_sheet(classData);
  wsClass['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsClass, '班主任班级课表');

  XLSX.writeFile(wb, outPath);
  return outPath;
}

module.exports = {
  DEFAULT_PERIODS,
  parseScheduleFile,
  parseTimetableFile: parseScheduleFile,
  exportTemplateXlsx,
  guessColor,
};

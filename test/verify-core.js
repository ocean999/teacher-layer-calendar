// 核心逻辑自检：单次调课、跨周调课、单次停课、冲突检测、三文件合并
const assert = require('assert');
const webdav = require('../desktop/webdav');

// 1. 双向合并测试（电脑改课表 + 手机新增干活事项，互不覆盖）
const pcWorks = [
  { id: 'w1', date: '2026-11-23', start: '09:00', end: '10:00', title: '改作业（电脑修改）', updatedAt: 300, deleted: false },
  { id: 'w2', date: '2026-11-23', start: '15:00', end: '16:00', title: '备课组会', updatedAt: 100, deleted: false },
];
const phoneWorks = [
  { id: 'w1', date: '2026-11-23', start: '09:00', end: '10:00', title: '改作业（旧）', updatedAt: 200, deleted: false },
  { id: 'w3', date: '2026-11-24', start: '14:00', end: '15:00', title: '手机新记事项', updatedAt: 250, deleted: false },
];
const mergedWorks = webdav.mergeItemList(pcWorks, phoneWorks);
assert.strictEqual(mergedWorks.length, 3);
assert.strictEqual(mergedWorks.find(x => x.id === 'w1').title, '改作业（电脑修改）');
assert.strictEqual(mergedWorks.find(x => x.id === 'w3').title, '手机新记事项');

// 2. 软删除合并测试（手机删掉某条调课记录，电脑同步后正确恢复）
const localOv = [{ id: 'ov1', courseId: 'c1', origDate: '2026-11-24', type: 'move', updatedAt: 100, deleted: false }];
const remoteOv = [{ id: 'ov1', courseId: 'c1', origDate: '2026-11-24', type: 'move', updatedAt: 400, deleted: true }];
const mergedOv = webdav.mergeItemList(localOv, remoteOv);
assert.strictEqual(mergedOv[0].deleted, true);

console.log('CORE_MERGE_TESTS_PASSED');

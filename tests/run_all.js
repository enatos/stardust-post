const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MockRange {
  constructor(sheet, row, column, numRows, numColumns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows || 1;
    this.numColumns = numColumns || 1;
  }
  getValues() {
    return Array.from({ length: this.numRows }, (_, r) =>
      Array.from({ length: this.numColumns }, (_, c) =>
        this.sheet.valueAt(this.row - 1 + r, this.column - 1 + c)));
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((value, c) => {
      this.sheet.setValueAt(this.row - 1 + r, this.column - 1 + c, value);
    }));
    return this;
  }
  setValue(value) {
    this.sheet.setValueAt(this.row - 1, this.column - 1, value);
    return this;
  }
}

class MockSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = (rows || []).map(row => [...row]);
  }
  valueAt(row, column) {
    return (this.rows[row] && this.rows[row][column] !== undefined) ? this.rows[row][column] : '';
  }
  setValueAt(row, column, value) {
    while (this.rows.length <= row) this.rows.push([]);
    while (this.rows[row].length <= column) this.rows[row].push('');
    this.rows[row][column] = value;
  }
  getLastColumn() {
    return Math.max(0, ...this.rows.map(row => row.length));
  }
  getLastRow() {
    return this.rows.length;
  }
  getRange(row, column, numRows, numColumns) {
    return new MockRange(this, row, column, numRows, numColumns);
  }
  getDataRange() {
    return new MockRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  insertColumnsAfter(afterPosition, howMany) {
    this.rows.forEach(row => row.splice(afterPosition, 0, ...Array(howMany).fill('')));
  }
  appendRow(row) {
    this.rows.push([...row]);
  }
  setFrozenRows() {}
}

class MockSpreadsheet {
  constructor(sheets) {
    this.sheets = new Map(sheets.map(sheet => [sheet.name, sheet]));
  }
  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }
  insertSheet(name) {
    const sheet = new MockSheet(name, []);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

const legacyHeaders = [
  'post_id', 'content', 'created_at', 'received_at', 'source', 'status',
  'imported_work_date', 'imported_task_id', 'processed_at', 'updated_at'
];
const legacyRow = [
  '01M0F0EDTQAQ3P599NWX7NFQWN',
  '公開用の旧形式テストタスク',
  '2026-08-20T07:16:24.536+09:00',
  '2026-08-20T16:16:25+09:00',
  'mac_web', 'inbox', '', '', '', '2026-08-20T16:16:25+09:00'
];
const daySheet = new MockSheet('0820', [
  ['08/20', '', '今日のゴール: ', '公開用テストゴール', '', ''],
  ['完了', '公開OKレベルのアウトプット', 'AIちゃん', '担当', 'やること', 'メモ'],
  [false, false, 'テストプロジェクト', 'テスト担当', '公開用テストタスク', '公開用テストメモ']
]);
const inboxSheet = new MockSheet('stardust_inbox', [legacyHeaders, legacyRow]);
const spreadsheet = new MockSpreadsheet([inboxSheet, daySheet]);

const context = {
  console,
  Date,
  Math,
  Map,
  JSON,
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: key => key === 'STARDUST_TOKEN' ? 'test-token' : null })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    formatDate: (date, zone, pattern) => {
      if (pattern === 'yyyy-MM-dd') return '2026-08-20';
      return '2026-08-20T16:30:00+09:00';
    }
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType() { return this; } })
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Code.gs'), 'utf8'), context);
const body = response => JSON.parse(response.text);

const unauthorized = body(context.handleInbox({ token: 'wrong' }));
assert.deepStrictEqual(unauthorized, { ok: false, error: 'unauthorized' });
assert.strictEqual(inboxSheet.getLastColumn(), 10, 'unauthorized must not migrate or read the sheet');

const migratedInbox = body(context.handleInbox({ token: 'test-token' }));
assert.strictEqual(migratedInbox.ok, true);
assert.strictEqual(migratedInbox.items.length, 1);
assert.strictEqual(migratedInbox.items[0].todo, '公開用の旧形式テストタスク');
assert.strictEqual(migratedInbox.items[0].status, 'inbox');
assert.deepStrictEqual(inboxSheet.rows[0], [
  'post_id', 'todo', 'project', 'assigned_ai', 'memo', 'created_at', 'received_at',
  'source', 'status', 'imported_work_date', 'imported_task_id', 'processed_at', 'updated_at'
]);
assert.deepStrictEqual(inboxSheet.rows[1], [
  legacyRow[0], legacyRow[1], '', '', '', ...legacyRow.slice(2)
]);

const posted = body(context.handlePost({
  token: 'test-token', post_id: '01TESTPOST0000000000000001', todo: '新規投稿',
  project: '星屑ポスト', assigned_ai: 'エビ様', memo: '確認', source: 'web_pwa'
}));
assert.strictEqual(posted.ok, true);
assert.strictEqual(inboxSheet.rows.length, 3);
const duplicate = body(context.handlePost({
  token: 'test-token', post_id: '01TESTPOST0000000000000001', todo: '上書き禁止'
}));
assert.strictEqual(duplicate.is_duplicate, true);
assert.strictEqual(inboxSheet.rows.length, 3);
assert.strictEqual(inboxSheet.rows[2][1], '新規投稿');

const triaged = body(context.handleTriage({ token: 'test-token', updates: [{
  post_id: '01TESTPOST0000000000000001', status: 'imported',
  imported_work_date: '2026-08-20', imported_task_id: '01TASK00000000000000000001'
}] }));
assert.strictEqual(triaged.updated_count, 1);
assert.strictEqual(inboxSheet.rows[2][8], 'imported');
assert.strictEqual(inboxSheet.rows[2][10], '01TASK00000000000000000001');

const day = body(context.handleDay({ token: 'test-token', work_date: '2026-08-20' }));
assert.strictEqual(day.ok, true);
assert.strictEqual(day.goal, '公開用テストゴール');
assert.strictEqual(day.tasks.length, 1);
assert.strictEqual(day.tasks[0].todo, '公開用テストタスク');

const sync = require('../js/sync.js');
assert.strictEqual(
  sync.nowIsoTokyo(new Date('2026-08-20T07:16:24.536Z')),
  '2026-08-20T16:16:24.536+09:00'
);

const publicTextFiles = [
  'README.md', 'index.html', 'manifest.json', 'sw.js',
  'css/style.css', 'js/api.js', 'js/app.js', 'js/db.js', 'js/sync.js', 'js/ulid.js',
  'gas/Code.gs', 'shortcuts/iOSショートカット_設定ガイド.md',
  'icons/icon-192.svg', 'icons/icon-512.svg'
];
const forbiddenPublicPatterns = [
  { label: 'GAS deployment URL', regex: /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g },
  { label: 'GitHub token', regex: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { label: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: 'absolute macOS user path', regex: /\/Users\/[A-Za-z0-9._-]+\//g },
  { label: 'email address', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { label: 'Japanese phone number', regex: /(?:\+81[- ]?|0)(?:\d[- ]?){9,10}\d/g }
];
for (const relativePath of publicTextFiles) {
  const text = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  for (const pattern of forbiddenPublicPatterns) {
    assert.strictEqual(
      pattern.regex.test(text), false,
      `${pattern.label} found in public file: ${relativePath}`
    );
    pattern.regex.lastIndex = 0;
  }
}

console.log('PASS: migration, auth, post, triage, day goal, Tokyo timestamp, public security scan');

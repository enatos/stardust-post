/**
 * Code.gs - 星屑ポスト GAS Web API バックエンド (v1.2)
 *
 * 役割:
 * 1. POST action=post: 星屑の投函（todo 150字, project, assigned_ai, memo 500字、スクリプトロック、重複防止・冪等性）
 * 2. GET  action=projects: project_masterシートから「休眠」「卒業」以外のプロジェクト一覧を取得
 * 3. GET  action=inbox: 受信箱一覧取得（シークレット認証、received_at降順ソート）
 * 4. POST action=triage: ぽらりす入力UIからの仕分けステータス一括更新
 * 5. GET  action=day: 日付タブから今日のゴールとタスクを取得
 */

const SHEET_INBOX = 'stardust_inbox';
const SHEET_PROJECTS = 'project_master';
const TOKEN_PROP_KEY = 'STARDUST_TOKEN';
const MAX_TODO_LENGTH = 150;
const MAX_MEMO_LENGTH = 500;
const LOCK_TIMEOUT_MS = 30000;
const LEGACY_HEADERS = [
  'post_id',
  'content',
  'created_at',
  'received_at',
  'source',
  'status',
  'imported_work_date',
  'imported_task_id',
  'processed_at',
  'updated_at'
];

const HEADERS = [
  'post_id',
  'todo',
  'project',
  'assigned_ai',
  'memo',
  'created_at',
  'received_at',
  'source',
  'status',
  'imported_work_date',
  'imported_task_id',
  'processed_at',
  'updated_at'
];

/**
 * HTTP GET ハンドラ
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'inbox';

    if (action === 'inbox') {
      return handleInbox(params);
    } else if (action === 'projects') {
      return handleProjects(params);
    } else if (action === 'day') {
      return handleDay(params);
    }

    return createJsonResponse({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.message }, 500);
  }
}

/**
 * HTTP POST ハンドラ
 */
function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    let body = {};

    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return createJsonResponse({ ok: false, error: 'invalid_json' }, 400);
      }
    }

    const action = params.action || body.action || 'post';

    if (action === 'post') {
      return handlePost(body);
    } else if (action === 'triage') {
      return handleTriage(body);
    } else if (action === 'inbox') {
      return handleInbox(body);
    } else if (action === 'projects') {
      return handleProjects(body);
    } else if (action === 'day') {
      return handleDay(body);
    }

    return createJsonResponse({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.message }, 500);
  }
}

/**
 * 共有シークレットの検証
 */
function verifySecretToken(token) {
  const secret = PropertiesService.getScriptProperties().getProperty(TOKEN_PROP_KEY);
  if (!secret) {
    return false;
  }
  return token === secret;
}

/**
 * JST基準のISO 8601日時文字列を取得
 */
function getNowIsoJST() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * GAS内ULID生成ヘルパー
 */
function generateGasULID(seedTime) {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = typeof seedTime === 'number' ? seedTime : Date.now();
  let timeStr = '';
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32;
    timeStr = ENCODING.charAt(mod) + timeStr;
    time = Math.floor((time - mod) / 32);
  }
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += ENCODING.charAt(Math.floor(Math.random() * 32));
  }
  return timeStr + randStr;
}

/**
 * stardust_inbox シートを取得（存在しない場合はヘッダー付きで新規作成）
 */
function getInboxSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_INBOX);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_INBOX);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  ensureInboxSchema(sheet);
  return sheet;
}

/**
 * 旧10列を既存値を保ったまま13列へ移行し、想定外の列構造では停止する。
 */
function ensureInboxSchema(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), LEGACY_HEADERS.length);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .slice(0, lastColumn)
    .map(value => String(value || '').trim());
  const isCurrent = HEADERS.every((header, index) => current[index] === header);
  if (isCurrent) return;

  const isLegacy = LEGACY_HEADERS.every((header, index) => current[index] === header);
  if (!isLegacy) {
    throw new Error('stardust_inbox_schema_mismatch');
  }

  sheet.insertColumnsAfter(2, 3);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

/**
 * 1. 投稿API (POST action=post)
 */
function handlePost(body) {
  // 認証
  if (!verifySecretToken(body.token)) {
    return createJsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  // 構造化フィールドの抽出（後方互換で content 単体も許容）
  let todo = (body.todo || '').trim();
  let memo = (body.memo || '').trim();
  const project = (body.project || '').trim();
  const assignedAi = (body.assigned_ai || '').trim();

  if (!todo && body.content) {
    const rawContent = String(body.content).trim();
    if (rawContent.length <= MAX_TODO_LENGTH) {
      todo = rawContent;
      memo = '';
    } else {
      todo = rawContent.slice(0, MAX_TODO_LENGTH);
      memo = rawContent.slice(MAX_TODO_LENGTH, MAX_TODO_LENGTH + MAX_MEMO_LENGTH);
    }
  }

  if (!todo) {
    return createJsonResponse({ ok: false, error: 'empty_todo' }, 400);
  }

  if (todo.length > MAX_TODO_LENGTH) {
    return createJsonResponse({ ok: false, error: 'todo_too_long' }, 400);
  }

  if (memo.length > MAX_MEMO_LENGTH) {
    return createJsonResponse({ ok: false, error: 'memo_too_long' }, 400);
  }

  let postId = (body.post_id || '').trim();
  if (!postId) {
    postId = generateGasULID();
  }

  const createdAt = body.created_at || getNowIsoJST();
  const source = body.source || 'web_pwa';
  const nowIso = getNowIsoJST();

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);

    const sheet = getInboxSheet();
    const data = sheet.getDataRange().getValues();

    // 既存 post_id 検索（重複防止 & 冪等性保証）
    if (data.length > 1) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === postId) {
          // 既存行は一切変更せずスキップし成功応答（statusを巻き戻さない）
          return createJsonResponse({
            ok: true,
            post_id: postId,
            status: String(data[i][8] || 'inbox'),
            is_duplicate: true
          });
        }
      }
    }

    // 新規行を末尾に追加
    const newRow = [
      postId,
      todo,
      project,
      assignedAi,
      memo,
      createdAt,
      nowIso,      // received_at
      source,
      'inbox',     // status
      '',          // imported_work_date
      '',          // imported_task_id
      '',          // processed_at
      nowIso       // updated_at
    ];

    sheet.appendRow(newRow);

    return createJsonResponse({
      ok: true,
      post_id: postId,
      status: 'inbox'
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 2. プロジェクトマスター取得API (GET action=projects)
 * project_master シートから「休眠」「卒業」以外のプロジェクト一覧を抽出
 */
function handleProjects(params) {
  if (!verifySecretToken(params.token)) {
    return createJsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_PROJECTS);
  if (!sheet) {
    return createJsonResponse({ ok: true, projects: [] });
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return createJsonResponse({ ok: true, projects: [] });
  }

  const headers = data[0].map(h => String(h).trim());
  let projectColIdx = 0;
  let statusColIdx = -1;

  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (h.includes('プロジェクト') || h.toLowerCase().includes('project')) {
      projectColIdx = c;
    }
    if (h.includes('状態') || h.includes('ステータス') || h.toLowerCase().includes('status')) {
      statusColIdx = c;
    }
  }

  const excludeStatuses = ['休眠', '卒業', 'archived', 'done', 'closed'];
  const projects = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const pName = String(row[projectColIdx] || '').trim();
    if (!pName) continue;

    let pStatus = '';
    if (statusColIdx >= 0) {
      pStatus = String(row[statusColIdx] || '').trim();
    }

    const isExcluded = excludeStatuses.some(ex => pStatus.includes(ex));
    if (!isExcluded) {
      if (!projects.includes(pName)) {
        projects.push(pName);
      }
    }
  }

  return createJsonResponse({
    ok: true,
    projects: projects
  });
}

/**
 * 3. 受信箱取得API (GET action=inbox)
 */
function handleInbox(params) {
  if (!verifySecretToken(params.token)) {
    return createJsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const filterStatus = params.status ? params.status.split(',').map(s => s.trim()) : ['inbox', 'hold'];
  const limit = Math.min(Math.max(parseInt(params.limit, 10) || 100, 1), 500);

  const sheet = getInboxSheet();
  const data = sheet.getDataRange().getValues();

  const items = [];
  if (data.length > 1) {
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const postId = String(row[0] || '');
      if (!postId) continue;

      const todo = String(row[1] || '');
      const project = String(row[2] || '');
      const assignedAi = String(row[3] || '');
      const memo = String(row[4] || '');
      const createdAt = formatIsoString(row[5]);
      const receivedAt = formatIsoString(row[6]);
      const source = String(row[7] || '');
      const status = String(row[8] || 'inbox');

      if (filterStatus.includes(status)) {
        items.push({
          post_id: postId,
          todo: todo,
          project: project,
          assigned_ai: assignedAi,
          memo: memo,
          content: memo ? `${todo}\n${memo}` : todo,
          created_at: createdAt,
          received_at: receivedAt,
          source: source,
          status: status
        });
      }
    }
  }

  items.sort((a, b) => (new Date(b.received_at).getTime() || 0) - (new Date(a.received_at).getTime() || 0));

  return createJsonResponse({
    ok: true,
    items: items.slice(0, limit)
  });
}

/**
 * 4. トリアージ更新API (POST action=triage)
 */
function handleTriage(body) {
  if (!verifySecretToken(body.token)) {
    return createJsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (updates.length === 0) {
    return createJsonResponse({ ok: true, updated_count: 0, skipped: [] });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);

    const sheet = getInboxSheet();
    const data = sheet.getDataRange().getValues();
    const nowIso = getNowIsoJST();

    const rowIndexMap = new Map();
    for (let i = 1; i < data.length; i++) {
      const pId = String(data[i][0]);
      if (pId) {
        rowIndexMap.set(pId, i + 1); // 1-indexed
      }
    }

    let updatedCount = 0;
    const skipped = [];

    for (const update of updates) {
      const targetPostId = String(update.post_id || '');
      if (!targetPostId || !rowIndexMap.has(targetPostId)) {
        skipped.push(targetPostId);
        continue;
      }

      const rowNum = rowIndexMap.get(targetPostId);
      // 列位置 (13列構造):
      // 9: status (I列)
      // 10: imported_work_date (J列)
      // 11: imported_task_id (K列)
      // 12: processed_at (L列)
      // 13: updated_at (M列)

      const status = update.status !== undefined ? String(update.status) : undefined;
      if (status !== undefined && !['inbox', 'hold', 'imported', 'dismissed'].includes(status)) {
        skipped.push(targetPostId);
        continue;
      }
      const importedWorkDate = update.imported_work_date !== undefined ? String(update.imported_work_date) : undefined;
      const importedTaskId = update.imported_task_id !== undefined ? String(update.imported_task_id) : undefined;
      const processedAt = update.processed_at || nowIso;

      if (status !== undefined) sheet.getRange(rowNum, 9).setValue(status);
      if (importedWorkDate !== undefined) sheet.getRange(rowNum, 10).setValue(importedWorkDate);
      if (importedTaskId !== undefined) sheet.getRange(rowNum, 11).setValue(importedTaskId);
      sheet.getRange(rowNum, 12).setValue(processedAt);
      sheet.getRange(rowNum, 13).setValue(nowIso);

      updatedCount++;
    }

    return createJsonResponse({
      ok: true,
      updated_count: updatedCount,
      skipped: skipped
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 5. 日付タブ取得API (GET action=day&work_date=YYYY-MM-DD)
 */
function handleDay(params) {
  if (!verifySecretToken(params.token)) {
    return createJsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const workDate = String(params.work_date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return createJsonResponse({ ok: false, error: 'invalid_work_date' }, 400);
  }

  const sheetName = workDate.slice(5, 7) + workDate.slice(8, 10);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    return createJsonResponse({ ok: true, found: false, work_date: workDate, goal: '', tasks: [] });
  }

  const lastRow = Math.max(sheet.getLastRow(), 2);
  const values = sheet.getRange(1, 1, lastRow, 6).getValues();
  const goal = String((values[0] && values[0][3]) || '').trim();
  const headers = (values[1] || []).map(value => String(value || '').trim());
  const expected = ['完了', '公開OKレベルのアウトプット', 'AIちゃん', '担当', 'やること', 'メモ'];
  if (!expected.every((header, index) => headers[index] === header)) {
    return createJsonResponse({ ok: false, error: 'day_sheet_schema_mismatch', sheet_name: sheetName }, 409);
  }

  const tasks = [];
  for (let rowIndex = 2; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const todo = String(row[4] || '').trim();
    const memo = String(row[5] || '').trim();
    if (!todo && !memo) continue;
    tasks.push({
      source_row: rowIndex + 1,
      completed: row[0] === true || String(row[0]).toUpperCase() === 'TRUE',
      publish_ready: row[1] === true || String(row[1]).toUpperCase() === 'TRUE',
      project_label: String(row[2] || '').trim(),
      ai_label: String(row[3] || '').trim(),
      todo: todo,
      memo: memo
    });
  }

  return createJsonResponse({
    ok: true,
    found: true,
    work_date: workDate,
    sheet_name: sheetName,
    goal: goal,
    tasks: tasks
  });
}

/**
 * ISO日時文字列の整形ヘルパー
 */
function formatIsoString(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(val);
}

/**
 * JSON レスポンス生成ヘルパー
 */
function createJsonResponse(obj, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * 렌즈로 여는 탐구 질문 (질문하는 힘 기르기 · 4차시) · 서버 코드 (Google Apps Script)
 *
 * 여러 선생님이 함께 쓰는 서버 하나예요. 개발진이 한 번 배포해 두면, 선생님은 아무 설정 없이 써요.
 *  - 선생님마다 브라우저에 자동으로 생기는 열쇠로 자기 게임만 다뤄요.
 *  - 게임, 자료, 학생 질문, 보드는 게임을 만든 뒤 하루(24시간)가 지나면 모두 지워져요.
 *
 * 서버 만들기 (개발진, 처음 한 번)
 *  1. 구글 시트를 새로 만들고 [확장 프로그램 → Apps Script]를 열어요.
 *  2. 원래 내용을 모두 지우고 이 파일 내용을 붙여 넣은 뒤 저장해요.
 *  3. 함수 고르는 칸에서 setup 을 고르고 [실행] → 권한을 허용해요. (시트 탭이 만들어져요)
 *  4. [배포 → 새 배포 → 웹 앱] (실행: 나 / 액세스 권한: 모든 사용자) → 웹 앱 URL(…/exec)을
 *     사이트 js/config.js 의 SERVER_URL 에 넣어요.
 *  5. 코드를 고친 뒤에는 [배포 → 배포 관리 → 연필(수정) → 버전: 새 버전 → 배포]로 같은 주소를 유지해요.
 *
 * 시트 탭
 *  - 「4차시 질문」  : 학생이 쓰고 고친 질문이 한 줄씩 쌓여요. (같은 아이디는 가장 나중 줄이 지금 모습)
 *  - 「4차시 저장소」: 자료 설정, 그림, 보드가 조각으로 들어가요. (숨긴 탭)
 *
 * 이 스크립트는 연결된 이 시트 한 개에만 접근해요.
 * @OnlyCurrentDoc
 */

var APP_VERSION = '4.0.0';
var Q_SHEET = '4차시 질문';
var B_SHEET = '4차시 저장소';
var Q_HEAD = ['게임 코드', '학생', '별명', '번호', '질문', '렌즈', '자료', '쓴 시각', '아이디', '상태', '저장 시각'];
var B_HEAD = ['게임 코드', '이름', '조각', '내용'];
var TTL_MS = 24 * 3600 * 1000; // 게임 · 자료 · 질문 · 보드 모두 하루 뒤 지움
var LIMIT = {
  gamesPerTeacher: 6,
  gamesTotal: 100, // 스크립트 속성(전체 500KB)에 게임 진행 정보가 들어가므로 넉넉히 잡는다
  students: 60,
  perStudent: 20,
  text: 100,
  name: 8,
  title: 30,
  lens: 24,
  mat: 24,
  cfgChars: 300000, // 자료 설정(글 · 표 · 렌즈) 전체 글자 수
  blobChars: 1200000, // 그림 한 장(문자열) 최대
  blobsPerGame: 40,
  totalBlobChars: 12000000,
  boardChars: 400000,
};
var FLUSH_AFTER_END_MS = 90 * 1000; // 활동 종료 직후 아직 못 보낸 질문은 잠깐 더 받아 준다
var CELL = 45000; // 시트 칸 하나에 넣을 조각 크기 (칸 하나는 5만 글자까지)
var CACHE_PART = 30000; // 캐시 조각 크기 (캐시 한 칸은 100KB까지)
var CACHE_SEC = 21600; // 캐시는 6시간까지
var CLEANUP_EVERY_MS = 15 * 60 * 1000;
var TIME_ZONE = 'Asia/Seoul';

// ════════════════════════════════════════════════
// 편집기에서 직접 실행하는 함수
// ════════════════════════════════════════════════

/** [개발진] 시트 탭을 만들어요. 처음 한 번 실행하고 권한을 허용해 주세요. */
function setup() {
  ensureSheets();
  Logger.log(
    '준비 완료! (렌즈로 여는 탐구 질문 서버 ' + APP_VERSION + ')\n' +
      '이제 [배포 → 새 배포 → 웹 앱] (실행: 나 / 액세스 권한: 모든 사용자)으로 배포하고, ' +
      '웹 앱 URL을 사이트 js/config.js의 SERVER_URL에 넣어 주세요.\n' +
      '코드를 고친 뒤에는 [배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포]로 같은 주소를 유지해요.'
  );
}

/** [개발진] 기한이 지난 게임을 지금 바로 정리해요. (평소에는 저절로 정리돼요) */
function cleanupNow() {
  var removed = withLock(function () {
    return cleanupExpired(Date.now());
  });
  Logger.log('정리한 게임: ' + (removed.length ? removed.join(', ') : '없음'));
}

// ════════════════════════════════════════════════
// 웹 앱 입구
// ════════════════════════════════════════════════

function doGet(e) {
  return respond({
    ok: true,
    app: 'question-lens',
    version: APP_VERSION,
    shared: true,
    now: Date.now(),
    message: '렌즈로 여는 탐구 질문(4차시) 서버가 잘 동작하고 있어요.',
  });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respond({ ok: false, error: 'BAD_REQUEST', now: Date.now() });
  }
  return respond(handle(body));
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 이름: [처리 함수, 선생님 열쇠 필요 여부, 한 번에 하나씩 처리(잠금) 필요 여부]
var ACTIONS = {
  hello: [act_hello, false, false],
  'r4.create': [r4_create, true, true],
  'r4.cfgPut': [r4_cfgPut, true, true],
  'r4.blobPut': [r4_blobPut, true, true],
  'r4.list': [r4_list, true, false],
  'r4.view': [r4_view, true, false],
  'r4.stage': [r4_stage, true, true],
  'r4.release': [r4_release, true, true],
  'r4.items': [r4_items, true, false],
  'r4.boardGet': [r4_boardGet, true, false],
  'r4.boardPut': [r4_boardPut, true, true],
  'r4.delete': [r4_delete, true, true],
  cleanup: [act_cleanup, true, true],
  'r4.info': [r4_info, false, false],
  'r4.cfg': [r4_cfg, false, false],
  'r4.blob': [r4_blob, false, false],
  'r4.join': [r4_join, false, true],
  'r4.poll': [r4_poll, false, false],
  'r4.mine': [r4_mine, false, false],
  'r4.save': [r4_save, false, false],
};

function handle(body) {
  var name = String((body && body.action) || '');
  var entry = ACTIONS.hasOwnProperty(name) ? ACTIONS[name] : null;
  if (!entry) return { ok: false, error: 'UNKNOWN_ACTION', now: Date.now() };
  try {
    if (entry[1] && !keyOf(body)) fail('NO_KEY');
    var res = entry[2] ? withLock(function () { return entry[0](body); }) : entry[0](body);
    res = res || {};
    if (res.ok === undefined) res.ok = true;
    res.now = Date.now();
    return res;
  } catch (err) {
    var msg = String((err && err.message) || err);
    var code = (err && err.code) || (/too many times|simultaneous|quota|한도|너무 많/i.test(msg) ? 'BUSY' : 'SERVER_ERROR');
    return { ok: false, error: code, message: msg, now: Date.now() };
  }
}

function fail(code, message) {
  var e = new Error(message || code);
  e.code = code;
  throw e;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail('BUSY');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════════════════
// 저장 도우미
// ════════════════════════════════════════════════

function props() {
  return PropertiesService.getScriptProperties();
}

function cache() {
  return CacheService.getScriptCache();
}

function cacheGet(k) {
  try {
    return cache().get(k);
  } catch (e) {
    return null;
  }
}

function cachePut(k, v, sec) {
  try {
    cache().put(k, v, sec || CACHE_SEC);
    return true;
  } catch (e) {
    cacheDel(k);
    return false;
  }
}

function cacheDel(k) {
  try {
    cache().remove(k);
  } catch (e) {}
}

function cacheGetAll(keys) {
  if (!keys.length) return {};
  try {
    return cache().getAll(keys) || {};
  } catch (e) {
    return {};
  }
}

// 선생님을 알아보는 열쇠 (브라우저마다 자동으로 만들어짐)
function keyOf(b) {
  var k = String((b && b.tk) || '');
  return /^[A-Za-z0-9_-]{16,64}$/.test(k) ? k : '';
}

function cleanCode(c) {
  c = String(c || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(c)) fail('BAD_CODE');
  return c;
}

function clampInt(v, min, max, dflt) {
  var n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function cleanText(s, max) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanId(s) {
  s = String(s || '');
  return /^[A-Za-z0-9_-]{1,48}$/.test(s) ? s : '';
}

// 시트가 글자를 수식·날짜·숫자로 바꾸지 않도록 앞에 '를 붙인다. (시트에는 '가 보이지 않아요)
function asText(s) {
  return "'" + String(s === null || s === undefined ? '' : s);
}

function fmtTime(ms) {
  return Utilities.formatDate(new Date(ms), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
}

// ── 게임 진행 정보 (스크립트 속성 'r4:코드') ─────────────

function r4Load(code, fresh) {
  var key = 'r4:' + code;
  var s = fresh ? null : cacheGet(key);
  if (!s) {
    s = props().getProperty(key);
    if (s) cachePut(key, s);
  }
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function r4Must(code, fresh) {
  var g = r4Load(cleanCode(code), fresh);
  if (!g) fail('NO_GAME');
  return g;
}

function r4Save(g) {
  var s = JSON.stringify(g);
  props().setProperty('r4:' + g.code, s);
  cachePut('r4:' + g.code, s);
}

function r4Teacher(b, fresh) {
  var g = r4Must(b.code, fresh);
  if (g.owner !== keyOf(b)) fail('NOT_OWNER');
  return g;
}

function r4All() {
  var all = props().getProperties();
  var out = [];
  for (var k in all) {
    if (!all.hasOwnProperty(k) || k.indexOf('r4:') !== 0) continue;
    try {
      out.push(JSON.parse(all[k]));
    } catch (e) {
      out.push({ code: k.slice(3), broken: true });
    }
  }
  return out;
}

function r4Public(g) {
  var students = {};
  for (var k in g.students) {
    if (g.students.hasOwnProperty(k)) {
      var s = g.students[k];
      students[k] = { name: s.name, joinedAt: s.joinedAt, out: !!s.out };
    }
  }
  return {
    code: g.code,
    title: g.title || '',
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
    status: g.status,
    endedAt: g.endedAt || null,
    ready: !!g.ready,
    cfgRev: g.cfgRev || 0,
    students: students,
    updatedAt: g.updatedAt,
  };
}

function newCode() {
  var p = props();
  for (var i = 0; i < 150; i++) {
    var c = String(1000 + Math.floor(Math.random() * 9000));
    if (!p.getProperty('r4:' + c)) return c;
  }
  fail('NO_CODE');
}

// ── 시트 ─────────────────────────────────────────────

function ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets() {
  var book = ss();
  var q = book.getSheetByName(Q_SHEET);
  if (!q) {
    q = book.insertSheet(Q_SHEET);
    q.getRange(1, 1, 1, Q_HEAD.length).setValues([Q_HEAD]).setFontWeight('bold').setBackground('#e4eed7');
    q.setFrozenRows(1);
    q.setColumnWidth(5, 380);
  }
  var b = book.getSheetByName(B_SHEET);
  if (!b) {
    b = book.insertSheet(B_SHEET);
    b.getRange(1, 1, 1, B_HEAD.length).setValues([B_HEAD]).setFontWeight('bold');
    b.setFrozenRows(1);
    b.hideSheet();
  }
  return { q: q, b: b };
}

function qSheet() {
  return ss().getSheetByName(Q_SHEET) || ensureSheets().q;
}

function bSheet() {
  return ss().getSheetByName(B_SHEET) || ensureSheets().b;
}

// 이어진 줄 묶음을 아래쪽부터 지운다.
function deleteRowList(sh, rows) {
  rows = rows.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rows.length) {
    var end = rows[i];
    var start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) {
      i++;
      start = rows[i];
    }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
}

// ── 저장소: 긴 글(자료 설정 · 보드)과 그림을 조각으로 나눠 시트와 캐시에 둔다 ──

function blobCacheKey(code, name) {
  return 'r4b:' + code + ':' + name;
}

function blobCachePut(code, name, data) {
  var base = blobCacheKey(code, name);
  var parts = {};
  var n = 0;
  for (var i = 0; i < data.length; i += CACHE_PART, n++) parts[base + ':' + n] = data.slice(i, i + CACHE_PART);
  try {
    if (n) cache().putAll(parts, CACHE_SEC);
    cache().put(base, String(n), CACHE_SEC);
  } catch (e) {
    cacheDel(base);
  }
}

function blobCacheGet(code, name) {
  var base = blobCacheKey(code, name);
  var n = cacheGet(base);
  if (n === null || n === undefined || n === '') return null;
  n = Number(n);
  if (!n) return '';
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(base + ':' + i);
  var got = cacheGetAll(keys);
  var out = '';
  for (var j = 0; j < n; j++) {
    var part = got[base + ':' + j];
    if (part === undefined || part === null) return null;
    out += part;
  }
  return out;
}

// 저장소 줄 목록 (게임 코드 · 이름 · 조각 번호만 읽는다)
function blobIndex(code, name) {
  var sh = bSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 3).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) !== code) continue;
    if (name !== null && String(vals[i][1]) !== name) continue;
    out.push({ row: i + 2, name: String(vals[i][1]), part: Number(vals[i][2]) });
  }
  return out;
}

function blobPut(code, name, data) {
  var sh = bSheet();
  var old = blobIndex(code, name).map(function (r) { return r.row; });
  if (old.length) deleteRowList(sh, old);
  var rows = [];
  for (var i = 0, part = 0; i < data.length; i += CELL, part++) {
    // 조각 앞에 b를 붙여 시트가 + 나 = 로 시작하는 글을 수식으로 읽지 않게 한다.
    rows.push([Number(code), asText(name), part, 'b' + data.slice(i, i + CELL)]);
  }
  if (!rows.length) rows.push([Number(code), asText(name), 0, 'b']);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, B_HEAD.length).setValues(rows);
  blobCachePut(code, name, data);
}

function blobGet(code, name) {
  var hit = blobCacheGet(code, name);
  if (hit !== null) return hit;
  var idx = blobIndex(code, name).sort(function (a, b) { return a.part - b.part; });
  if (!idx.length) return null;
  var sh = bSheet();
  var out = '';
  idx.forEach(function (r) {
    var v = String(sh.getRange(r.row, 4).getValue());
    out += v.charAt(0) === 'b' ? v.slice(1) : v;
  });
  blobCachePut(code, name, out);
  return out;
}

function blobForget(code, names) {
  names.forEach(function (name) {
    var base = blobCacheKey(code, name);
    var n = Number(cacheGet(base) || 0);
    cacheDel(base);
    for (var i = 0; i < n; i++) cacheDel(base + ':' + i);
  });
}

// ── 학생 질문: 시트에 한 줄씩 쌓고(같은 아이디는 나중 줄이 이긴다), 학생마다 캐시에 지금 모습을 둔다 ──

function qCacheKey(code, sid) {
  return 'r4q:' + code + ':' + sid;
}

function qRows(code) {
  var sh = qSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, Q_HEAD.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (code && String(v[0]) !== code) continue;
    out.push({
      row: i + 2,
      code: String(v[0]),
      sid: String(v[1]),
      no: Number(v[3]) || 0,
      text: String(v[4]),
      lens: String(v[5]),
      mat: String(v[6]),
      time: v[7] instanceof Date ? fmtTime(v[7].getTime()) : String(v[7]),
      id: String(v[8]),
      del: String(v[9]) === '지움',
      at: Number(v[10]) || 0,
    });
  }
  return out;
}

// 줄 기록 → 학생별 지금 질문 목록
function reduceRows(rows) {
  var by = {};
  rows.forEach(function (r) {
    var m = (by[r.sid] = by[r.sid] || {});
    var cur = m[r.id];
    if (!cur || r.at >= cur.at) m[r.id] = r;
  });
  var out = {};
  for (var sid in by) {
    if (!by.hasOwnProperty(sid)) continue;
    var list = [];
    for (var id in by[sid]) {
      if (by[sid].hasOwnProperty(id) && !by[sid][id].del) list.push(stripQ(by[sid][id]));
    }
    list.sort(function (a, b) { return a.no - b.no; });
    out[sid] = list;
  }
  return out;
}

function stripQ(r) {
  return { id: r.id, no: r.no, text: r.text, lens: r.lens, mat: r.mat, at: r.at, time: r.time };
}

// 학생들의 지금 질문 목록 { 학생: [질문] } (캐시에 없으면 시트를 한 번 읽어 채운다)
function questionsOf(g, sids) {
  var keys = sids.map(function (sid) { return qCacheKey(g.code, sid); });
  var got = cacheGetAll(keys);
  var out = {};
  var miss = [];
  sids.forEach(function (sid) {
    var v = got[qCacheKey(g.code, sid)];
    if (v === undefined || v === null) miss.push(sid);
    else {
      try {
        out[sid] = JSON.parse(v);
      } catch (e) {
        miss.push(sid);
      }
    }
  });
  if (miss.length) {
    var all = reduceRows(qRows(g.code));
    var put = {};
    miss.forEach(function (sid) {
      out[sid] = all[sid] || [];
      put[qCacheKey(g.code, sid)] = JSON.stringify(out[sid]);
    });
    try {
      cache().putAll(put, CACHE_SEC);
    } catch (e) {}
  }
  return out;
}

function allSids(g) {
  return Object.keys(g.students || {});
}

function countsOf(g) {
  var q = questionsOf(g, allSids(g));
  var out = {};
  for (var sid in q) if (q.hasOwnProperty(sid)) out[sid] = q[sid].length;
  return out;
}

// ── 접속 표시 (캐시: 6시간 뒤 저절로 사라짐) ───────────

function touchSeen(code, sid, now) {
  cachePut('r4seen:' + code + ':' + sid, String(now), CACHE_SEC);
}

function seenMap(g) {
  var sids = allSids(g);
  var got = cacheGetAll(sids.map(function (sid) { return 'r4seen:' + g.code + ':' + sid; }));
  var out = {};
  sids.forEach(function (sid) {
    var v = got['r4seen:' + g.code + ':' + sid];
    if (v) out[sid] = Number(v);
  });
  return out;
}

// ── 정리 ─────────────────────────────────────────────

function removeGameData(code, g) {
  props().deleteProperty('r4:' + code);
  cacheDel('r4:' + code);
  var names = {};
  blobIndex(code, null).forEach(function (r) { names[r.name] = true; });
  blobForget(code, Object.keys(names).concat(['cfg', 'board']));
  if (g) allSids(g).forEach(function (sid) { cacheDel(qCacheKey(code, sid)); });
}

// 기한이 지난 게임과, 주인 게임이 없는 줄을 모두 지운다.
function cleanupExpired(now) {
  var removed = [];
  var alive = {};
  r4All().forEach(function (g) {
    if (g.broken || (g.expiresAt && now > g.expiresAt)) {
      removeGameData(g.code, g.broken ? null : g);
      removed.push(g.code);
    } else alive[g.code] = true;
  });
  [qSheet(), bSheet()].forEach(function (sh) {
    var last = sh.getLastRow();
    if (last < 2) return;
    var codes = sh.getRange(2, 1, last - 1, 1).getValues();
    var orphan = [];
    for (var i = 0; i < codes.length; i++) if (!alive[String(codes[i][0])]) orphan.push(i + 2);
    if (orphan.length) deleteRowList(sh, orphan);
  });
  cachePut('r4cleanupAt', String(now), CACHE_SEC);
  return removed;
}

function maybeCleanup(now) {
  var last = Number(cacheGet('r4cleanupAt') || 0);
  if (now - last < CLEANUP_EVERY_MS) return [];
  return cleanupExpired(now);
}

// ════════════════════════════════════════════════
// 선생님 기능
// ════════════════════════════════════════════════

function act_hello() {
  return { version: APP_VERSION, shared: true };
}

function act_cleanup() {
  return { removed: maybeCleanup(Date.now()) };
}

function r4_create(b) {
  var s = b.settings || {};
  var now = Date.now();
  maybeCleanup(now);
  var mine = 0;
  var all = r4All();
  all.forEach(function (g) {
    if (g.owner === keyOf(b) && !(g.expiresAt && now > g.expiresAt)) mine++;
  });
  if (mine >= LIMIT.gamesPerTeacher) fail('TOO_MANY_GAMES');
  if (all.length >= LIMIT.gamesTotal) fail('SERVER_FULL');
  var title = cleanText(s.title, LIMIT.title);
  if (!title) fail('BAD_TITLE');
  var code = newCode();
  var game = {
    code: code,
    kind: 'r4',
    owner: keyOf(b),
    title: title,
    createdAt: now,
    expiresAt: now + TTL_MS,
    status: 'open',
    endedAt: null,
    ready: false,
    cfgRev: 0,
    blobChars: 0,
    blobCount: 0,
    students: {},
    nextSid: 1,
    updatedAt: now,
  };
  r4Save(game);
  return { code: code, game: r4Public(game) };
}

// 자료 설정(글 · 표 · 링크 · 렌즈 · 연습 그림 목록)을 통째로 저장한다.
function r4_cfgPut(b) {
  var g = r4Teacher(b, true);
  var cfg = String(b.cfg || '');
  if (!cfg) fail('BAD_CFG');
  if (cfg.length > LIMIT.cfgChars) fail('TOO_BIG');
  try {
    var parsed = JSON.parse(cfg);
    if (parsed.title) g.title = cleanText(parsed.title, LIMIT.title) || g.title;
  } catch (e) {
    fail('BAD_CFG');
  }
  blobPut(g.code, 'cfg', cfg);
  g.ready = true;
  g.cfgRev = (Number(g.cfgRev) || 0) + 1;
  g.updatedAt = Date.now();
  r4Save(g);
  return { game: r4Public(g) };
}

// 그림 한 장(이미지 · PDF 쪽 · 연습 그림)을 저장한다. 이름은 'm-…' 처럼 선생님 화면이 정한다.
function r4_blobPut(b) {
  var g = r4Teacher(b, true);
  var name = cleanId(b.name);
  if (!name || name === 'cfg' || name === 'board') fail('BAD_NAME');
  var data = String(b.data || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) fail('BAD_IMAGE');
  if (data.length > LIMIT.blobChars) fail('TOO_BIG');
  // 그림 수와 전체 크기만 센다 (같은 이름을 다시 올리면 조금 더 세어질 뿐 문제없다)
  var count = (Number(g.blobCount) || 0) + 1;
  if (count > LIMIT.blobsPerGame) fail('TOO_MANY_FILES');
  var total = (Number(g.blobChars) || 0) + data.length;
  if (total > LIMIT.totalBlobChars) fail('TOO_BIG');
  blobPut(g.code, name, data);
  g.blobCount = count;
  g.blobChars = total;
  g.updatedAt = Date.now();
  r4Save(g);
  return { saved: name };
}

function r4_list(b) {
  var now = Date.now();
  var out = [];
  r4All().forEach(function (g) {
    if (g.broken || g.owner !== keyOf(b)) return;
    if (g.expiresAt && now > g.expiresAt) return;
    out.push({
      code: g.code,
      title: g.title || '',
      status: g.status,
      ready: !!g.ready,
      createdAt: g.createdAt,
      expiresAt: g.expiresAt,
      students: allSids(g).filter(function (k) { return !g.students[k].out; }).length,
    });
  });
  out.sort(function (a, c) { return c.createdAt - a.createdAt; });
  return { games: out };
}

function r4_view(b) {
  var g = r4Teacher(b);
  return { game: r4Public(g), seen: seenMap(g), counts: countsOf(g) };
}

function r4_stage(b) {
  var g = r4Teacher(b, true);
  var now = Date.now();
  var op = String(b.op || '');
  if (op === 'end') {
    if (g.status !== 'ended') {
      g.status = 'ended';
      g.endedAt = now;
    }
  } else if (op === 'reopen') {
    g.status = 'open';
    g.endedAt = null;
  } else fail('BAD_OP');
  g.updatedAt = now;
  r4Save(g);
  return { game: r4Public(g) };
}

function r4_release(b) {
  var g = r4Teacher(b, true);
  var sid = cleanId(b.sid);
  var cur = g.students[sid];
  if (!cur) fail('NO_STUDENT');
  cur.out = true;
  cur.token = '';
  g.updatedAt = Date.now();
  r4Save(g);
  return { game: r4Public(g) };
}

// 모든 학생 질문 (끝난 뒤 보드에서 씀)
function r4_items(b) {
  var g = r4Teacher(b);
  return { game: r4Public(g), items: questionsOf(g, allSids(g)) };
}

function r4_boardGet(b) {
  var g = r4Teacher(b);
  return { board: blobGet(g.code, 'board') || '' };
}

function r4_boardPut(b) {
  var g = r4Teacher(b, true);
  var board = String(b.board || '');
  if (board.length > LIMIT.boardChars) fail('TOO_BIG');
  blobPut(g.code, 'board', board);
  return { saved: board.length };
}

function r4_delete(b) {
  var code = cleanCode(b.code);
  var g = r4Load(code, true);
  if (g && g.owner !== keyOf(b)) fail('NOT_OWNER');
  removeGameData(code, g);
  var q = qSheet();
  var rows = qRows(code).map(function (r) { return r.row; });
  if (rows.length) deleteRowList(q, rows);
  var bl = blobIndex(code, null).map(function (r) { return r.row; });
  if (bl.length) deleteRowList(bSheet(), bl);
  return { deleted: code };
}

// ════════════════════════════════════════════════
// 학생 태블릿 기능
// ════════════════════════════════════════════════

function liveGame(code) {
  var g = r4Must(code);
  if (Date.now() > g.expiresAt) fail('EXPIRED');
  return g;
}

function r4_info(b) {
  return { game: r4Public(liveGame(b.code)) };
}

function r4_cfg(b) {
  var g = liveGame(b.code);
  if (!g.ready) fail('NOT_READY');
  return { cfg: blobGet(g.code, 'cfg') || '', cfgRev: g.cfgRev || 0 };
}

function r4_blob(b) {
  var g = liveGame(b.code);
  var name = cleanId(b.name);
  if (!name || name === 'cfg' || name === 'board') fail('BAD_NAME');
  var data = blobGet(g.code, name);
  if (data === null) fail('NO_FILE');
  return { data: data };
}

function cleanName(s) {
  return cleanText(s, LIMIT.name);
}

function r4_join(b) {
  var g = r4Must(b.code, true);
  var now = Date.now();
  if (now > g.expiresAt) fail('EXPIRED');
  var token = String(b.token || '').slice(0, 64);
  // 같은 태블릿이 다시 들어오면 원래 자리로
  var sid = cleanId(b.sid);
  if (sid && g.students[sid] && token && g.students[sid].token === token && !g.students[sid].out) {
    touchSeen(g.code, sid, now);
    return { sid: sid, token: token, name: g.students[sid].name, game: r4Public(g) };
  }
  var name = cleanName(b.name);
  if (!name) fail('BAD_NAME');
  var live = allSids(g).filter(function (k) { return !g.students[k].out; });
  if (live.length >= LIMIT.students) fail('CLASS_FULL');
  // 같은 별명이 있으면 뒤에 번호를 붙인다
  var used = {};
  allSids(g).forEach(function (k) { if (!g.students[k].out) used[g.students[k].name] = true; });
  var base = name;
  var n = 2;
  while (used[name]) {
    var tail = String(n++);
    name = base.slice(0, Math.max(1, LIMIT.name - tail.length)) + tail;
  }
  sid = 's' + (g.nextSid || 1);
  g.nextSid = (g.nextSid || 1) + 1;
  token = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  g.students[sid] = { name: name, token: token, joinedAt: now };
  g.updatedAt = now;
  r4Save(g);
  touchSeen(g.code, sid, now);
  return { sid: sid, token: token, name: name, renamed: name !== base, game: r4Public(g) };
}

function studentOf(g, b) {
  var sid = cleanId(b.sid);
  var cur = sid && g.students[sid];
  if (!cur || cur.out || !cur.token || cur.token !== String(b.token || '')) fail('NOT_MINE');
  return sid;
}

function r4_poll(b) {
  var g = r4Load(cleanCode(b.code));
  var now = Date.now();
  if (!g || now > g.expiresAt) return { gone: true };
  var out = { game: r4Public(g) };
  if (b.sid) {
    var cur = g.students[String(b.sid)];
    out.mine = !!(cur && !cur.out && cur.token && cur.token === String(b.token || ''));
    if (out.mine) touchSeen(g.code, String(b.sid), now);
  }
  return out;
}

function r4_mine(b) {
  var g = liveGame(b.code);
  var sid = studentOf(g, b);
  return { game: r4Public(g), items: questionsOf(g, [sid])[sid] || [] };
}

// 질문 저장: 바뀐 질문만 보낸다. 같은 아이디는 'at'이 더 나중인 것만 받는다 (다시 보내도 안전)
//  items: [{ id, no, text, lens, mat, at, del }]
function r4_save(b) {
  var g = liveGame(b.code);
  var now = Date.now();
  var sid = studentOf(g, b);
  if (g.status === 'ended' && now - (g.endedAt || 0) > FLUSH_AFTER_END_MS) fail('ENDED');
  var list = Array.isArray(b.items) ? b.items.slice(0, LIMIT.perStudent * 3) : [];
  var cur = questionsOf(g, [sid])[sid] || [];
  var byId = {};
  cur.forEach(function (x) { byId[x.id] = x; });
  var rows = [];
  var name = g.students[sid].name;
  list.forEach(function (x) {
    x = x || {};
    var id = cleanId(x.id);
    if (!id) return;
    var at = Math.min(Number(x.at) || now, now + 60000);
    var old = byId[id];
    if (old && old.at >= at) return;
    if (x.del) {
      if (!old) return;
      delete byId[id];
      rows.push([Number(g.code), asText(sid), asText(name), old.no, asText(old.text), asText(old.lens), asText(old.mat), asText(fmtTime(at)), asText(id), '지움', at]);
      return;
    }
    var text = cleanText(x.text, LIMIT.text);
    if (!text) return;
    if (!old && Object.keys(byId).length >= LIMIT.perStudent) return;
    var q = {
      id: id,
      no: clampInt(x.no, 1, 9999, old ? old.no : 1),
      text: text,
      lens: cleanText(x.lens, LIMIT.lens),
      mat: cleanText(x.mat, LIMIT.mat),
      at: at,
      time: fmtTime(at),
    };
    byId[id] = q;
    rows.push([Number(g.code), asText(sid), asText(name), q.no, asText(q.text), asText(q.lens), asText(q.mat), asText(q.time), asText(id), '쓰기', at]);
  });
  if (rows.length) {
    var sh = qSheet();
    rows.forEach(function (r) { sh.appendRow(r); });
  }
  var next = Object.keys(byId).map(function (k) { return byId[k]; });
  next.sort(function (a, c) { return a.no - c.no; });
  cachePut(qCacheKey(g.code, sid), JSON.stringify(next));
  touchSeen(g.code, sid, now);
  return { saved: rows.length, items: next, game: r4Public(g) };
}

// 학생 화면 (4차시 렌즈로 여는 탐구 질문) · 학생 한 명이 태블릿 한 대
// 게임 코드 → 별명 → 처음 화면(버튼 두 개)
//  ① 렌즈를 통해 질문하기: 연습 그림을 보며 렌즈별 질문 틀로 질문을 만들어 본다 (이 태블릿에만 남음)
//  ② 프로젝트 탐구 질문 만들기: 선생님 자료를 보며 내 질문을 쓴다 (렌즈는 골라도 되고 안 골라도 됨, 저절로 저장)
// 친구 질문은 보이지 않는다. 선생님이 [활동 종료]를 누르면 더 고칠 수 없다.

import { $, esc, toast, openModal, confirmBox, watchConnection, brandHtml, catSvg, lensIcon, ICON, isComposingEnter } from './ui.js';
import { cleanQuestion, cleanName } from './game.js';
import { hasServer } from './api.js';
import { lensClient, pruneImageCache } from './r4api.js';
import { BUILTIN_PICTURES, LENS_EXAMPLE_TOPIC, LIMITS, NO_LENS, lensById, firstBlank, uid } from './lenses.js';
import { matIcon, matTitle, matThumbHtml, matBodyHtml, hydrate } from './materials.js';

const app = document.getElementById('app');
const SESSION_KEY = 'ql-student';
const params = new URLSearchParams(location.search);
const urlMode = params.get('mode') === 'local' ? 'local' : null;

const T = {
  mode: null,
  cli: null,
  code: null,
  game: null,
  cfg: null,
  cfgRev: -1,
  sid: null,
  token: null,
  name: '',
  items: [],
  dirty: {},
  dels: [],
  practice: [],
  view: 'join',
  pic: null,
  lens: null,
  plens: null,
  edit: null,
  matIdx: 0,
  page: 0,
  pollTimer: null,
  saveTimer: null,
  saving: false,
  saveErr: '',
  loaded: false,
  stopConn: null,
  draft: '',
  pdraft: '',
  useMat: true,
};

const ended = () => !!(T.game && T.game.status === 'ended');
const lenses = () => (T.cfg && T.cfg.lenses) || [];
const mats = () => (T.cfg && T.cfg.materials) || [];
const pictures = () => {
  const list = (T.cfg && T.cfg.pictures) || [];
  return list.length ? list : BUILTIN_PICTURES.map((p) => ({ id: p.id, title: p.title, hint: p.hint, builtin: true }));
};
const lensInfo = (id) => (id ? lensById(lenses(), id) : NO_LENS);
const now = () => (T.cli ? T.cli.serverNow() : Date.now());
const imgSrc = (name) => T.cli.getImage(T.code, name);
const picSrc = (p) => {
  if (p.builtin) {
    const b = BUILTIN_PICTURES.find((x) => x.id === p.id);
    return Promise.resolve(b ? b.src : null);
  }
  return imgSrc(p.img);
};

// ── 세션 (이 태블릿에 기억) ─────────────────────────
//  창마다(sessionStorage) 기억하고, 수업 모드에서는 태블릿에도(localStorage) 기억해 브라우저를 닫았다 열어도 이어진다.
//  연습 모드는 한 컴퓨터에 학생 창을 여러 개 띄우므로 창마다 따로 기억한다.

function saveSession() {
  if (!T.code) return;
  const s = JSON.stringify({ mode: T.mode, code: T.code, sid: T.sid, token: T.token, name: T.name, items: T.items, dirty: T.dirty, dels: T.dels, practice: T.practice, pic: T.pic, at: Date.now() });
  try {
    sessionStorage.setItem(SESSION_KEY, s);
  } catch (e) {}
  if (T.mode === 'server')
    try {
      localStorage.setItem(SESSION_KEY, s);
    } catch (e) {}
}

function loadSession() {
  const ok = (s) => s && s.code && Date.now() - (s.at || 0) < 26 * 3600000;
  try {
    const a = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (ok(a)) return a;
  } catch (e) {}
  try {
    const b = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (ok(b) && b.mode === 'server') return b;
  } catch (e) {}
  return null;
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function explain(e) {
  return T.cli ? T.cli.explain(e, 'student') : String((e && e.message) || e);
}

function topbar(right = '') {
  const sub = T.name ? `${T.name} · 4차시` : '학생용 · 4차시';
  return `<header class="topbar st-top">${brandHtml(sub)}<div class="spacer"></div>${right}</header>`;
}

// ════════════════════════════════════════════════
// 1. 게임 코드 · 별명
// ════════════════════════════════════════════════

function renderJoin(prefill = '', error = '') {
  stopLoops();
  T.view = 'join';
  app.classList.remove('wide');
  app.innerHTML = `
    ${topbar(`<a class="btn btn-cream btn-sm" href="index.html">${ICON.back}처음으로</a>`)}
    <section class="card pad-lg center-card" aria-labelledby="h">
      <span class="deco butter" style="width:220px;height:220px;right:-80px;top:-90px"></span>
      <span class="deco green" style="width:160px;height:160px;left:-60px;bottom:-70px"></span>
      <div class="mascot-row" style="margin-bottom:18px">${catSvg(92)}<div class="bubble">렌즈로 질문을 찾아볼까요?<br>선생님이 알려 준 <b>게임 코드</b>를 입력해 봐요.</div></div>
      <h1 id="h" class="sr-only">렌즈로 여는 탐구 질문 입장</h1>
      <form id="join-form" class="stack" style="gap:20px" novalidate>
        <div class="field">
          <label for="code">게임 코드</label>
          <input class="input code" id="code" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]*" placeholder="0000" value="${esc(prefill)}">
        </div>
        <div id="join-err" aria-live="assertive">${error ? `<div class="notice apricot"><div>${esc(error)}</div></div>` : ''}</div>
        <button type="submit" class="btn btn-apricot btn-lg" id="join-btn">들어가기 ${ICON.arrow}</button>
      </form>
    </section>`;
  const codeEl = $('#code');
  codeEl.addEventListener('input', () => (codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 4)));
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    findGame($('#code').value.trim());
  });
  setTimeout(() => T.view === 'join' && $('#code') && $('#code').focus(), 50);
}

function joinError(msg) {
  const box = $('#join-err');
  if (box) box.innerHTML = `<div class="notice apricot"><div>${esc(msg)}</div></div>`;
  const btn = $('#join-btn') || $('#name-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `들어가기 ${ICON.arrow}`;
  }
}

function candidates() {
  if (urlMode === 'local') return ['local'];
  return hasServer() ? ['server', 'local'] : ['local'];
}

async function findGame(code) {
  if (!/^\d{4}$/.test(code)) return joinError('게임 코드 4자리를 입력해 주세요.');
  const btn = $('#join-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '찾는 중…';
  }
  let lastErr = null;
  for (const mode of candidates()) {
    try {
      const cli = await lensClient(mode);
      const game = await cli.info(code);
      setClient(cli, mode);
      T.code = code;
      T.game = game;
      const sess = loadSession();
      if (sess && sess.code === code && sess.mode === mode && sess.sid && sess.token) return restore(sess);
      resetPerson();
      return renderName();
    } catch (e) {
      if (!lastErr || (lastErr.code === 'NO_GAME' && e.code !== 'NO_GAME')) lastErr = e;
    }
  }
  if (!hasServer() && urlMode !== 'local') return joinError('아직 서버가 준비되지 않았어요. 선생님께 알려 주세요.');
  joinError(lastErr ? explain(lastErr) : '게임 코드를 다시 확인해 주세요.');
}

function setClient(cli, mode) {
  T.cli = cli;
  T.mode = mode;
  if (T.stopConn) T.stopConn();
  T.stopConn = watchConnection(cli);
}

function resetPerson() {
  Object.assign(T, { sid: null, token: null, name: '', items: [], dirty: {}, dels: [], practice: [], pic: null, loaded: false, edit: null, draft: '', pdraft: '' });
}

function renderName(note = '') {
  stopLoops();
  T.view = 'name';
  app.classList.remove('wide');
  app.innerHTML = `
    ${topbar(`<button type="button" class="btn btn-cream btn-sm" data-act="to-join">${ICON.back}다른 코드</button>`)}
    <section class="card pad-lg center-card" aria-labelledby="h">
      <span class="deco green" style="width:200px;height:200px;right:-70px;top:-90px"></span>
      <div class="mascot-row" style="margin-bottom:16px">${catSvg(86)}<div class="bubble"><b>${esc(T.game.title || '우리 반 프로젝트')}</b>에 들어왔어요!<br>선생님이 알아볼 수 있게 <b>별명(이름)</b>을 써 주세요.</div></div>
      <h1 id="h" class="sr-only">별명 쓰기</h1>
      <form id="name-form" class="stack" style="gap:18px" novalidate>
        ${note ? `<div class="notice apricot"><div>${esc(note)}</div></div>` : ''}
        <div class="field">
          <label for="nm">별명 (이름)</label>
          <input class="input big-name" id="nm" maxlength="${LIMITS.name}" autocomplete="off" placeholder="예: 가온" value="">
          <div class="count">${LIMITS.name}글자까지 · 친구 질문에는 별명이 보이지 않아요</div>
        </div>
        <div id="join-err" aria-live="assertive"></div>
        <button type="submit" class="btn btn-apricot btn-lg" id="name-btn">들어가기 ${ICON.arrow}</button>
      </form>
    </section>`;
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doJoin($('#nm').value);
  });
  setTimeout(() => $('#nm') && $('#nm').focus(), 50);
}

async function doJoin(raw) {
  const c = cleanName(raw);
  if (!c.ok) return joinError(c.message);
  const btn = $('#name-btn');
  btn.disabled = true;
  btn.textContent = '들어가는 중…';
  try {
    const r = await T.cli.join(T.code, c.name);
    Object.assign(T, { sid: r.sid, token: r.token, name: r.name, game: r.game });
    if (r.renamed) toast(`같은 별명이 있어서 「${r.name}」(으)로 들어왔어요.`);
    saveSession();
    await enterAfterJoin();
  } catch (e) {
    joinError(explain(e));
  }
}

// 들어온 뒤: 자료 설정을 받아 처음 화면으로. 선생님이 아직 자료를 올리는 중이면 기다렸다가 다시 받는다
async function enterAfterJoin(restored = false) {
  const code = T.code;
  for (;;) {
    try {
      await loadCfg();
      break;
    } catch (e) {
      if (T.code !== code) return;
      if (e.code !== 'NOT_READY') throw e;
      renderWaitCfg();
      await new Promise((r) => setTimeout(r, 3000));
      if (T.code !== code || T.view !== 'wait') return;
    }
  }
  saveSession();
  startLoops();
  renderHome();
  if (restored) loadMine();
}

function renderWaitCfg() {
  if (T.view === 'wait') return;
  T.view = 'wait';
  app.classList.remove('wide');
  app.innerHTML = `${topbar(exitBtn())}
    <section class="card pad-lg center-card"><div class="mascot-row">${catSvg(90)}<div class="bubble">선생님이 자료를 올리고 있어요.<br>조금만 기다리면 저절로 시작돼요.</div></div></section>`;
}

async function restore(sess) {
  Object.assign(T, {
    sid: sess.sid,
    token: sess.token,
    name: sess.name || '',
    items: Array.isArray(sess.items) ? sess.items : [],
    dirty: sess.dirty || {},
    dels: Array.isArray(sess.dels) ? sess.dels : [],
    practice: Array.isArray(sess.practice) ? sess.practice : [],
    pic: sess.pic || null,
  });
  try {
    const r = await T.cli.join(T.code, T.name, T.sid, T.token);
    if (r.sid !== sess.sid) {
      // 선생님이 연결을 풀었다 → 새 자리
      resetPerson();
      return renderName('선생님이 이 태블릿의 연결을 풀었어요. 별명을 쓰고 다시 들어와 주세요.');
    }
    T.game = r.game;
    T.name = r.name;
    await enterAfterJoin(true);
  } catch (e) {
    renderJoin(T.code, explain(e));
  }
}

async function loadCfg() {
  const r = await T.cli.getCfg(T.code);
  T.cfg = r.cfg;
  T.cfgRev = r.rev;
  if (!T.pic || !pictures().some((p) => p.id === T.pic)) T.pic = (pictures()[0] || {}).id || null;
  if (!T.lens || !lenses().some((l) => l.id === T.lens)) T.lens = (lenses()[0] || {}).id || null;
}

// 서버에 저장된 내 질문으로 맞추기 (이 태블릿에서 아직 못 보낸 것은 남긴다)
async function loadMine() {
  try {
    const list = await T.cli.mine(T.code, T.sid, T.token);
    mergeServer(list);
    T.loaded = true;
    saveSession();
    if (T.view === 'project' || T.view === 'home') render();
  } catch (e) {
    if (e.code === 'NOT_MINE') return kicked();
  }
}

function mergeServer(list) {
  const local = new Map(T.items.map((x) => [x.id, x]));
  const delIds = new Set(T.dels.map((d) => d.id));
  const next = (list || []).filter((x) => !delIds.has(x.id)).map((x) => (T.dirty[x.id] && local.has(x.id) ? local.get(x.id) : { id: x.id, no: x.no, text: x.text, lens: x.lens, mat: x.mat, at: x.at }));
  T.items.forEach((x) => {
    if (T.dirty[x.id] && !next.some((y) => y.id === x.id)) next.push(x);
  });
  next.sort((a, b) => a.no - b.no);
  T.items = next;
}

// ════════════════════════════════════════════════
// 상태 확인 · 저장
// ════════════════════════════════════════════════

function stopLoops() {
  clearTimeout(T.pollTimer);
  T.pollTimer = null;
}

function startLoops() {
  stopLoops();
  T.pollTimer = setTimeout(poll, 1500);
  if (Object.keys(T.dirty).length || T.dels.length) scheduleSave(500);
}

async function poll() {
  clearTimeout(T.pollTimer);
  if (!T.code || !T.sid) return;
  const code = T.code;
  try {
    const r = await T.cli.poll(T.code, T.sid, T.token);
    if (T.code !== code) return;
    if (r.gone) {
      clearSession();
      return renderJoin('', '게임이 정리되었어요. 선생님께 새 게임 코드를 받아 주세요.');
    }
    if (r.mine === false) return kicked();
    const wasEnded = ended();
    T.game = r.game;
    if (T.game.cfgRev !== T.cfgRev) {
      await loadCfg();
      if (T.view !== 'project') render();
      else drawMaterials();
    }
    if (ended() !== wasEnded) {
      if (ended()) {
        saveNow();
        T.edit = null;
        toast('활동이 끝났어요. 선생님 화면을 함께 봐요.');
      } else toast('선생님이 활동을 다시 열었어요. 질문을 더 쓸 수 있어요.');
      render();
    }
  } catch (e) {
    if (e.code === 'NOT_MINE') return kicked();
  } finally {
    if (T.code === code && T.sid) T.pollTimer = setTimeout(poll, T.cli.pollMs(document.hidden ? 'hidden' : ended() ? 'studentDone' : 'student'));
  }
}

function kicked() {
  stopLoops();
  resetPerson();
  clearSession();
  renderName('선생님이 이 태블릿의 연결을 풀었어요. 별명을 쓰고 다시 들어와 주세요.');
}

function scheduleSave(ms = 1500) {
  clearTimeout(T.saveTimer);
  T.saveTimer = setTimeout(saveNow, ms);
  drawSaveState();
}

async function saveNow() {
  clearTimeout(T.saveTimer);
  if (!T.code || !T.sid) return;
  if (T.saving) {
    T.saveTimer = setTimeout(saveNow, 800);
    return;
  }
  const sent = T.items.filter((x) => T.dirty[x.id]).map((x) => ({ ...x }));
  const dels = T.dels.slice();
  if (!sent.length && !dels.length) return drawSaveState();
  T.saving = true;
  drawSaveState();
  try {
    const r = await T.cli.save(T.code, T.sid, T.token, sent.concat(dels.map((d) => ({ id: d.id, del: true, at: d.at }))));
    sent.forEach((x) => {
      const cur = T.items.find((y) => y.id === x.id);
      if (!cur || cur.at === x.at) delete T.dirty[x.id];
    });
    T.dels = T.dels.filter((d) => !dels.includes(d));
    if (!Object.keys(T.dirty).length && !T.dels.length) mergeServer(r.items);
    if (r.game) T.game = r.game;
    T.saveErr = '';
    saveSession();
  } catch (e) {
    if (e.code === 'NOT_MINE') {
      T.saving = false;
      return kicked();
    }
    if (e.code === 'ENDED') {
      T.saveErr = '활동이 끝나서 마지막 질문을 보내지 못했어요.';
      T.dirty = {};
      T.dels = [];
      saveSession();
    } else {
      T.saveErr = '인터넷 연결을 확인하는 중이에요. 다시 연결되면 저절로 보내요.';
      T.saveTimer = setTimeout(saveNow, 4000);
    }
  } finally {
    T.saving = false;
    drawSaveState();
    if (T.view === 'project') drawMine();
  }
}

function drawSaveState() {
  const el = $('#save-state');
  if (!el) return;
  const pending = Object.keys(T.dirty).length || T.dels.length;
  if (T.saveErr) {
    el.className = 'save-state warn';
    el.textContent = T.saveErr;
  } else if (T.saving || pending) {
    el.className = 'save-state';
    el.textContent = '저장하는 중…';
  } else {
    el.className = 'save-state';
    el.innerHTML = T.items.length ? `${ICON.check.replace('#fff', 'currentColor')}저장됨` : '';
  }
}

// ════════════════════════════════════════════════
// 2. 처음 화면: 버튼 두 개
// ════════════════════════════════════════════════

function render() {
  if (T.view === 'lens') renderLens();
  else if (T.view === 'project') renderProject();
  else if (T.view === 'home') renderHome();
}

function exitBtn() {
  return `<button type="button" class="btn btn-ghost btn-sm" data-act="exit">나가기</button>`;
}

function renderHome() {
  T.view = 'home';
  app.classList.remove('wide');
  const done = ended();
  app.innerHTML = `
    ${topbar(exitBtn())}
    <section class="card pad st-hello">
      <span class="deco butter" style="width:200px;height:200px;right:-70px;top:-90px"></span>
      <div class="mascot-row">${catSvg(84)}<div><div class="eyebrow">우리 반 프로젝트</div><h1 class="st-proj">${esc((T.cfg && T.cfg.title) || T.game.title)}</h1>
        ${T.cfg && T.cfg.intro ? `<p class="section-desc" style="margin:4px 0 0;font-size:18px">${esc(T.cfg.intro)}</p>` : ''}</div></div>
      ${done ? `<div class="notice green" style="margin-top:16px"><div><strong>활동이 끝났어요</strong>이제 선생님 화면에서 우리 반 질문을 함께 봐요. 내가 쓴 질문은 ②에서 볼 수 있어요.</div></div>` : ''}
    </section>
    <section class="big-choices" aria-label="활동 고르기">
      <button type="button" class="big-choice lens" data-act="go" data-v="lens">
        <span class="bc-num">1</span>
        <span class="bc-art">${lensIcon(76)}</span>
        <span class="bc-t">렌즈를 통해 질문하기</span>
        <span class="bc-d">렌즈마다 다른 질문 틀을 살펴보고, 그림을 보며 질문을 만들어 연습해요.</span>
        <span class="bc-foot">${T.practice.length ? `연습 질문 ${T.practice.length}개` : '연습해 보기'} ${ICON.arrow}</span>
      </button>
      <button type="button" class="big-choice proj" data-act="go" data-v="project">
        <span class="bc-num">2</span>
        <span class="bc-art">${projArt()}</span>
        <span class="bc-t">프로젝트 탐구 질문 만들기</span>
        <span class="bc-d">선생님이 준 자료를 살펴보고, 궁금한 것을 내 질문으로 써요.</span>
        <span class="bc-foot">${T.items.length ? `내 질문 ${T.items.length}개` : done ? '내 질문 보기' : '질문 쓰러 가기'} ${ICON.arrow}</span>
      </button>
    </section>`;
}

function projArt() {
  return `<svg aria-hidden="true" width="76" height="76" viewBox="0 0 76 76">
    <rect x="6" y="10" width="40" height="52" rx="7" fill="#fffdf6" stroke="#7a5c3e" stroke-width="3"/>
    <path d="M14 22h24M14 31h20M14 40h24M14 49h14" stroke="#e1d3b8" stroke-width="4" stroke-linecap="round"/>
    <rect x="34" y="30" width="36" height="28" rx="7" fill="#fdf3cf" stroke="#c99a1b" stroke-width="3" transform="rotate(-6 52 44)"/>
    <text x="52" y="51" text-anchor="middle" font-size="18" font-weight="700" fill="#7a5a10" font-family="Dunggeunmiso, sans-serif" transform="rotate(-6 52 44)">?</text>
  </svg>`;
}

// ════════════════════════════════════════════════
// 3. ① 렌즈를 통해 질문하기 (연습)
// ════════════════════════════════════════════════

function lensChipsHtml(cur, act, { allowNone = false } = {}) {
  return `<div class="lens-chips" role="${allowNone ? 'group' : 'tablist'}">${lenses()
    .map((l) => `<button type="button" class="lchip ${l.id === cur ? 'on' : ''}" data-act="${act}" data-v="${esc(l.id)}" aria-pressed="${l.id === cur}" style="--lc:${l.color.main};--ls:${l.color.soft};--li:${l.color.ink}">${esc(l.name)}</button>`)
    .join('')}</div>`;
}

function framesHtml(l, act) {
  return `<div class="frames">${l.frames.map((f, i) => `<button type="button" class="frame-btn" data-act="${act}" data-i="${i}">${esc(f)}<span>${ICON.plus}</span></button>`).join('')}</div>`;
}

function renderLens() {
  T.view = 'lens';
  app.classList.add('wide');
  const pics = pictures();
  const pic = pics.find((p) => p.id === T.pic) || pics[0];
  const L = lenses().find((l) => l.id === T.lens) || lenses()[0] || { ...NO_LENS, desc: '', frames: [] };
  app.innerHTML = `
    ${topbar(`<button type="button" class="btn btn-cream btn-sm" data-act="go" data-v="home">${ICON.back}처음 화면</button>`)}
    <div class="sub-head"><span class="sh-num">1</span><h1>렌즈를 통해 질문하기</h1><span class="sh-note">렌즈를 바꿔 끼우면 같은 그림에서도 다른 질문이 보여요</span></div>
    <div class="lens-play">
      <section class="card lp-pic" aria-label="연습 그림">
        <figure class="lp-figure"><img id="lp-img" alt="${esc(pic ? pic.title : '')}" data-zoom></figure>
        <div class="lp-cap"><b>${esc(pic ? pic.title : '')}</b>${pic && pic.hint ? `<span>${esc(pic.hint)}</span>` : ''}</div>
        ${pics.length > 1 ? `<div class="lp-pics" role="group" aria-label="다른 그림">${pics.map((p) => `<button type="button" class="lp-th ${p.id === (pic && pic.id) ? 'on' : ''}" data-act="pic" data-v="${esc(p.id)}" aria-label="${esc(p.title)}"><img data-pic="${esc(p.id)}" alt=""></button>`).join('')}</div>` : ''}
      </section>
      <section class="card lp-work" aria-label="렌즈와 질문 틀">
        ${lensChipsHtml(T.lens, 'lens')}
        <div class="lens-detail" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}">
          <div class="ld-head"><span class="ld-name">${esc(L.name)}</span><span class="ld-desc">${esc(L.desc)}</span></div>
          <div class="ld-label">질문 틀 · 누르면 아래 칸에 들어가요</div>
          ${framesHtml(L, 'frame')}
          ${L.example ? `<div class="ld-ex"><span>예시 · 주제: ${esc(LENS_EXAMPLE_TOPIC)}</span>${esc(L.example)}</div>` : ''}
        </div>
        <form class="composer" id="p-form" novalidate>
          <label for="p-text" class="sr-only">연습 질문</label>
          <textarea class="input" id="p-text" rows="2" maxlength="${LIMITS.text}" placeholder="그림을 보고 ${esc(L.name)} 렌즈로 질문을 만들어 봐요.">${esc(T.pdraft)}</textarea>
          <div class="row" style="gap:10px"><span class="count" id="p-msg"></span><span class="spacer"></span><button type="submit" class="btn btn-primary">${ICON.plus}연습 질문 담기</button></div>
        </form>
      </section>
    </div>
    <section class="card pad practice-list" aria-labelledby="pl-h">
      <div class="row"><h2 class="section-title" id="pl-h" style="font-size:22px">내 연습 질문 <span class="chip cream">${T.practice.length}</span></h2><span class="spacer"></span><span class="fl-note">이 태블릿에만 남아요 · 프로젝트 질문으로 보낼 수 있어요</span></div>
      <div class="notes" id="p-list"></div>
    </section>`;
  const img = $('#lp-img');
  if (pic) picSrc(pic).then((src) => src && (img.src = src));
  app.querySelectorAll('img[data-pic]').forEach((el) => {
    const p = pics.find((x) => x.id === el.dataset.pic);
    if (!p) return;
    if (p.builtin) {
      const b = BUILTIN_PICTURES.find((x) => x.id === p.id);
      if (b) el.src = b.thumb;
    } else picSrc(p).then((src) => src && (el.src = src));
  });
  $('#p-text').addEventListener('input', (e) => (T.pdraft = e.target.value));
  $('#p-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addPractice();
  });
  $('#p-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposingEnter(e)) {
      e.preventDefault();
      addPractice();
    }
  });
  drawPractice();
}

function drawPractice() {
  const box = $('#p-list');
  if (!box) return;
  if (!T.practice.length) {
    box.innerHTML = `<div class="empty-state" style="padding:14px">질문 틀을 눌러 ○○ 자리를 바꿔 쓰면 질문이 완성돼요.</div>`;
    return;
  }
  const pics = pictures();
  box.innerHTML = T.practice
    .slice()
    .reverse()
    .map((q) => {
      const L = lensInfo(q.lens);
      const p = pics.find((x) => x.id === q.pic);
      return `<div class="note" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}">
        <div class="nt-top"><span class="nt-lens">${esc(L.name)}</span>${p ? `<span class="nt-src">${esc(p.title)}</span>` : ''}</div>
        <div class="nt-text">${esc(q.text)}</div>
        <div class="nt-tools">${q.moved ? '<span class="nt-moved">② 프로젝트 질문으로 보냈어요</span>' : `<button type="button" class="btn btn-cream btn-sm" data-act="p-move" data-id="${esc(q.id)}" ${ended() ? 'disabled' : ''}>${ICON.send}프로젝트 질문으로</button>`}
          <button type="button" class="btn btn-ghost btn-icon" data-act="p-del" data-id="${esc(q.id)}" aria-label="지우기">${ICON.trash}</button></div>
      </div>`;
    })
    .join('');
}

function insertFrame(ta, frame) {
  const cur = ta.value;
  const a = ta.selectionStart ?? cur.length;
  const b = ta.selectionEnd ?? cur.length;
  const before = cur.slice(0, a);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  const next = (before + sep + frame + cur.slice(b)).slice(0, LIMITS.text);
  ta.value = next;
  const start = before.length + sep.length;
  const blank = firstBlank(frame);
  ta.focus();
  if (blank) ta.setSelectionRange(start + blank[0], start + blank[1]);
  else ta.setSelectionRange(start + frame.length, start + frame.length);
  ta.dispatchEvent(new Event('input'));
}

function addPractice() {
  const ta = $('#p-text');
  const msg = $('#p-msg');
  const c = cleanQuestion(ta.value);
  if (!c.ok) {
    msg.textContent = c.message;
    msg.classList.add('warn');
    return;
  }
  if (/○○|△△/.test(c.text)) {
    msg.textContent = '○○, △△ 자리를 알맞은 말로 바꿔 써 봐요.';
    msg.classList.add('warn');
    return;
  }
  T.practice.push({ id: uid('p'), text: c.text, lens: T.lens, pic: T.pic, at: Date.now() });
  if (T.practice.length > 60) T.practice.shift();
  T.pdraft = '';
  ta.value = '';
  msg.classList.remove('warn');
  msg.textContent = c.addedMark ? '물음표를 붙여서 담았어요.' : '담았어요!';
  saveSession();
  renderLens();
}

function movePractice(id) {
  const q = T.practice.find((x) => x.id === id);
  if (!q || ended()) return;
  if (T.items.length >= LIMITS.perStudent) return toast(`프로젝트 질문은 ${LIMITS.perStudent}개까지 쓸 수 있어요.`, 'warn');
  if (T.items.some((x) => x.text === q.text)) return toast('이미 프로젝트 질문에 있어요.');
  addItem(q.text, q.lens, '');
  q.moved = true;
  saveSession();
  drawPractice();
  toast('② 프로젝트 탐구 질문에 넣었어요.', 'good');
}

// ════════════════════════════════════════════════
// 4. ② 프로젝트 탐구 질문 만들기
// ════════════════════════════════════════════════

function renderProject() {
  T.view = 'project';
  app.classList.add('wide');
  const done = ended();
  const list = mats();
  app.innerHTML = `
    ${topbar(`<span class="save-state" id="save-state" aria-live="polite"></span><button type="button" class="btn btn-cream btn-sm" data-act="go" data-v="home">${ICON.back}처음 화면</button>`)}
    <div class="sub-head"><span class="sh-num">2</span><h1>프로젝트 탐구 질문 만들기</h1><span class="sh-note">${esc((T.cfg && T.cfg.title) || '')}</span></div>
    ${done ? `<div class="notice green" style="margin-bottom:14px"><div><strong>활동이 끝났어요</strong>이제 질문을 고칠 수 없어요. 선생님 화면에서 우리 반 질문을 함께 봐요.</div></div>` : ''}
    <div class="proj-grid ${list.length ? '' : 'no-mats'}">
      ${list.length ? `<section class="card mat-view" aria-label="선생님 자료"><div class="mv-strip" id="mv-strip"></div><div class="mv-stage" id="mv-stage"></div></section>` : ''}
      <section class="proj-side">
        ${done ? '' : composerHtml()}
        <div class="card pad mine" aria-labelledby="mine-h">
          <div class="row"><h2 class="section-title" id="mine-h" style="font-size:22px">내 질문 <span class="chip cream" id="mine-n">${T.items.length} / ${LIMITS.perStudent}</span></h2><span class="spacer"></span><span class="fl-note">친구 질문은 활동이 끝난 뒤 함께 봐요</span></div>
          <div class="notes" id="mine-list"></div>
        </div>
      </section>
    </div>`;
  if (!done) bindComposer();
  drawMaterials();
  drawMine();
  drawSaveState();
}

function composerHtml() {
  const L = T.plens ? lenses().find((l) => l.id === T.plens) : null;
  const m = mats()[T.matIdx];
  return `<form class="card composer big" id="q-form" novalidate>
    <div class="cp-head"><b>${T.edit ? '질문 고치기' : '질문 쓰기'}</b>${T.edit ? '<span class="chip butter">고치는 중</span>' : ''}</div>
    <label for="q-text" class="sr-only">질문</label>
    <textarea class="input" id="q-text" rows="3" maxlength="${LIMITS.text}" placeholder="자료를 살펴보고 궁금한 것을 질문으로 써 보세요.">${esc(T.draft)}</textarea>
    <div class="cp-lens"><span class="cp-label">렌즈 <span>골라도 되고, 안 골라도 돼요</span></span>${lensChipsHtml(T.plens, 'plens', { allowNone: true })}</div>
    ${L ? `<div class="cp-frames" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}"><span class="cp-label">${esc(L.name)} 질문 틀 <span>누르면 칸에 들어가요</span></span>${framesHtml(L, 'qframe')}</div>` : ''}
    <div class="row" style="gap:10px">
      ${m ? `<label class="check cp-mat"><input type="checkbox" id="q-mat" ${T.useMat ? 'checked' : ''}> <span>「${esc(matTitle(m, T.matIdx))}」 보고 썼어요</span></label>` : ''}
      <span class="count" id="q-msg"></span><span class="spacer"></span>
      ${T.edit ? `<button type="button" class="btn btn-ghost" data-act="q-cancel">취소</button>` : ''}
      <button type="submit" class="btn btn-primary btn-lg" id="q-btn">${T.edit ? `${ICON.check}고치기 완료` : `${ICON.plus}질문 붙이기`}</button>
    </div>
  </form>`;
}

function bindComposer() {
  const ta = $('#q-text');
  if (!ta) return;
  ta.addEventListener('input', () => (T.draft = ta.value));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposingEnter(e)) {
      e.preventDefault();
      submitQuestion();
    }
  });
  $('#q-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitQuestion();
  });
  const mc = $('#q-mat');
  if (mc) mc.addEventListener('change', () => (T.useMat = mc.checked));
}

function redrawComposer() {
  const old = $('#q-form');
  if (!old) return;
  const keep = old.querySelector('#q-text');
  const pos = keep ? [keep.selectionStart, keep.selectionEnd] : null;
  const focused = document.activeElement === keep;
  old.outerHTML = composerHtml();
  bindComposer();
  const ta = $('#q-text');
  if (ta && focused && pos) {
    ta.focus();
    ta.setSelectionRange(pos[0], pos[1]);
  }
}

function drawMaterials() {
  const strip = $('#mv-strip');
  const stage = $('#mv-stage');
  if (!strip || !stage) return;
  const list = mats();
  T.matIdx = Math.max(0, Math.min(list.length - 1, T.matIdx));
  strip.innerHTML = list
    .map((m, i) => `<button type="button" class="mv-th ${i === T.matIdx ? 'on' : ''}" data-act="mat" data-i="${i}" aria-pressed="${i === T.matIdx}"><span class="pt-img">${matThumbHtml(m)}</span><span class="pt-t">${i + 1}. ${esc(matTitle(m, i))}</span></button>`)
    .join('');
  const m = list[T.matIdx];
  stage.innerHTML = m
    ? `<div class="pr-title">${matIcon(m.kind)}<b>${esc(matTitle(m, T.matIdx))}</b><span class="spacer"></span><span class="pr-n">${T.matIdx + 1} / ${list.length}</span></div><div class="mv-content" id="mv-content">${matBodyHtml(m, { page: T.page })}</div>`
    : '';
  hydrate(strip, imgSrc);
  hydrate(stage, imgSrc);
  const on = strip.querySelector('.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function drawMine() {
  const box = $('#mine-list');
  if (!box) return;
  const n = $('#mine-n');
  if (n) n.textContent = `${T.items.length} / ${LIMITS.perStudent}`;
  if (!T.items.length) {
    box.innerHTML = `<div class="empty-state" style="padding:14px">${ended() ? '쓴 질문이 없어요.' : '위 칸에 질문을 써서 붙여 보세요.'}</div>`;
    return;
  }
  const list = mats();
  box.innerHTML = T.items
    .slice()
    .reverse()
    .map((q) => {
      const L = lensInfo(q.lens);
      const mi = list.findIndex((m) => m.id === q.mat);
      return `<div class="note ${T.edit === q.id ? 'editing' : ''}" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}">
        <div class="nt-top"><span class="nt-lens">${esc(L.name)}</span>${mi >= 0 ? `<span class="nt-src">${matIcon(list[mi].kind)}${esc(matTitle(list[mi], mi))}</span>` : ''}${T.dirty[q.id] ? '<span class="nt-wait" title="보내는 중">…</span>' : ''}</div>
        <div class="nt-text">${esc(q.text)}</div>
        ${ended() ? '' : `<div class="nt-tools"><button type="button" class="btn btn-cream btn-sm" data-act="q-edit" data-id="${esc(q.id)}">${ICON.edit}고치기</button><button type="button" class="btn btn-ghost btn-icon" data-act="q-del" data-id="${esc(q.id)}" aria-label="지우기">${ICON.trash}</button></div>`}
      </div>`;
    })
    .join('');
}

function addItem(text, lens, mat) {
  const no = T.items.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1;
  const q = { id: uid('q'), no, text, lens: lens || '', mat: mat || '', at: now() };
  T.items.push(q);
  T.dirty[q.id] = true;
  saveSession();
  scheduleSave();
  return q;
}

function submitQuestion() {
  if (ended()) return;
  const ta = $('#q-text');
  const msg = $('#q-msg');
  const warn = (t) => {
    msg.textContent = t;
    msg.classList.add('warn');
  };
  const c = cleanQuestion(ta.value);
  if (!c.ok) return warn(c.message);
  if (/○○|△△/.test(c.text)) return warn('○○, △△ 자리를 알맞은 말로 바꿔 써 봐요.');
  const m = mats()[T.matIdx];
  const mat = m && T.useMat ? m.id : '';
  if (T.edit) {
    const q = T.items.find((x) => x.id === T.edit);
    if (q) {
      if (T.items.some((x) => x.id !== q.id && x.text === c.text)) return warn('이미 쓴 질문이에요.');
      q.text = c.text;
      q.lens = T.plens || '';
      q.at = now();
      T.dirty[q.id] = true;
      saveSession();
      scheduleSave();
    }
    T.edit = null;
    toast('질문을 고쳤어요.', 'good');
  } else {
    if (T.items.length >= LIMITS.perStudent) return warn(`질문은 ${LIMITS.perStudent}개까지 쓸 수 있어요. 마음에 덜 드는 질문을 지워 볼까요?`);
    if (T.items.some((x) => x.text === c.text)) return warn('이미 쓴 질문이에요.');
    addItem(c.text, T.plens, mat);
  }
  T.draft = '';
  T.plens = null;
  redrawComposer();
  const m2 = $('#q-msg');
  if (m2) m2.textContent = c.addedMark ? '물음표를 붙여서 붙였어요.' : '붙였어요!';
  drawMine();
}

function startEdit(id) {
  const q = T.items.find((x) => x.id === id);
  if (!q || ended()) return;
  T.edit = id;
  T.draft = q.text;
  T.plens = q.lens || null;
  redrawComposer();
  drawMine();
  const ta = $('#q-text');
  if (ta) {
    ta.focus();
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

async function delQuestion(id) {
  const q = T.items.find((x) => x.id === id);
  if (!q || ended()) return;
  const ok = await confirmBox({ title: '이 질문을 지울까요?', body: esc(q.text), ok: '지우기', danger: true });
  if (!ok) return;
  T.items = T.items.filter((x) => x.id !== id);
  delete T.dirty[id];
  T.dels.push({ id, at: now() });
  if (T.edit === id) {
    T.edit = null;
    T.draft = '';
    redrawComposer();
  }
  saveSession();
  scheduleSave(400);
  drawMine();
}

// ════════════════════════════════════════════════
// 클릭 처리
// ════════════════════════════════════════════════

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const v = el.dataset.v;
  switch (el.dataset.act) {
    case 'to-join':
      renderJoin(T.code || '');
      break;
    case 'exit': {
      const pending = Object.keys(T.dirty).length || T.dels.length;
      const ok = await confirmBox({
        title: '나갈까요?',
        body: pending ? '아직 보내지 못한 질문이 있어요. 인터넷 연결을 확인한 뒤 나가 주세요.' : '같은 태블릿으로 다시 들어오면 쓰던 질문이 그대로 있어요.',
        ok: '나가기',
        danger: !!pending,
      });
      if (!ok) return;
      if (!pending) saveSession();
      stopLoops();
      const code = T.code;
      T.code = null;
      renderJoin(code || '');
      break;
    }
    case 'go':
      if (v === 'home') {
        T.edit = null;
        renderHome();
      } else if (v === 'lens') renderLens();
      else {
        renderProject();
        if (!T.loaded) loadMine();
      }
      window.scrollTo(0, 0);
      break;
    case 'pic':
      T.pic = v;
      saveSession();
      renderLens();
      break;
    case 'lens':
      T.lens = v;
      renderLens();
      break;
    case 'frame': {
      const L = lenses().find((l) => l.id === T.lens) || lenses()[0];
      if (L) insertFrame($('#p-text'), L.frames[Number(el.dataset.i)] || '');
      break;
    }
    case 'p-move':
      movePractice(el.dataset.id);
      break;
    case 'p-del':
      T.practice = T.practice.filter((x) => x.id !== el.dataset.id);
      saveSession();
      renderLens();
      break;
    case 'plens':
      T.plens = T.plens === v ? null : v;
      redrawComposer();
      break;
    case 'qframe': {
      const L = lenses().find((l) => l.id === T.plens);
      if (L) insertFrame($('#q-text'), L.frames[Number(el.dataset.i)] || '');
      break;
    }
    case 'mat':
      T.matIdx = Number(el.dataset.i);
      T.page = 0;
      drawMaterials();
      redrawComposer();
      break;
    case 'pdf-prev':
    case 'pdf-next': {
      const m = mats()[T.matIdx];
      if (!m) return;
      T.page = Math.max(0, Math.min((m.pages || []).length - 1, T.page + (el.dataset.act === 'pdf-next' ? 1 : -1)));
      const c = $('#mv-content');
      c.innerHTML = matBodyHtml(m, { page: T.page });
      hydrate(c, imgSrc);
      break;
    }
    case 'q-edit':
      startEdit(el.dataset.id);
      break;
    case 'q-cancel':
      T.edit = null;
      T.draft = '';
      T.plens = null;
      redrawComposer();
      drawMine();
      break;
    case 'q-del':
      delQuestion(el.dataset.id);
      break;
    default:
  }
});

// 그림을 누르면 크게 보기
app.addEventListener('click', (e) => {
  const img = e.target.closest('img[data-zoom]');
  if (!img || !img.src) return;
  const m = openModal(`<img src="${img.src}" alt="${esc(img.alt)}" class="zoom-img"><div class="actions" style="margin-top:12px"><button type="button" class="btn btn-cream" data-close>닫기</button></div>`, { wide: true, cls: 'zoom-modal' });
  m.el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) m.close();
  });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && T.sid) {
    clearTimeout(T.pollTimer);
    T.pollTimer = setTimeout(poll, 300);
  } else if (document.hidden && (Object.keys(T.dirty).length || T.dels.length)) saveNow();
});

window.addEventListener('pagehide', () => {
  if (Object.keys(T.dirty).length || T.dels.length) saveNow();
});

// ── 시작 ─────────────────────────────────────────────
(async function start() {
  pruneImageCache();
  const code = (params.get('code') || '').replace(/\D/g, '').slice(0, 4);
  const sess = loadSession();
  const first = code || (sess && (!urlMode || sess.mode === urlMode) ? sess.code : '');
  renderJoin(first);
  if (first) findGame(first);
})();

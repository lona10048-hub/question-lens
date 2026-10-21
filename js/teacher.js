// 선생님 화면 (4차시 렌즈로 여는 탐구 질문)
// 준비(프로젝트 · 자료 · 렌즈 · 연습 그림) → 진행(자료 크게 띄우기 · 렌즈 안내판 · 학생 현황, 제한 시간 없음)
// → [활동 종료] → 우리 반 탐구 질문 보드 → 프로젝트 탐구 질문 (렌즈 - 질문 쌍)

import { $, esc, toast, openModal, confirmBox, qrSvg, copyText, watchConnection, brandHtml, catSvg, lensIcon, ICON } from './ui.js';
import { isSoundOn, setSoundOn, SOUND_ICON, bell, flashBanner, unlockAudio } from './effects.js';
import { SERVER_RULES } from './config.js';
import { explainError, hasServer } from './api.js';
import { lensClient, pruneImageCache } from './r4api.js';
import { LENS_EXAMPLE_TOPIC } from './lenses.js';
import { matIcon, matTitle, matThumbHtml, matBodyHtml, hydrate } from './materials.js';
import { F, loadDraft, setupHtml, bindSetup, collectForCreate, problems, visibleLenses, visiblePictures, imageCount, clearDraft } from './setup.js';
import { mountBoard, unmountBoard } from './board.js';

const app = document.getElementById('app');
const MODE_KEY = 'ql-teacher-mode';
const SEEN_FRESH_MS = 40000;
const KEEP_H = SERVER_RULES.keepHours;

const S = {
  mode: loadMode(),
  cli: null,
  code: null,
  game: null,
  cfg: null,
  cfgRev: -1,
  seen: {},
  counts: {},
  view: 'home',
  built: null,
  tab: 'mat',
  matIdx: 0,
  page: 0,
  pollTimer: null,
  stopConn: null,
  studentsSig: '',
};

function loadMode() {
  if (!hasServer()) return 'local';
  try {
    return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'server';
  } catch (e) {
    return 'server';
  }
}

function setMode(m) {
  S.mode = hasServer() ? m : 'local';
  try {
    localStorage.setItem(MODE_KEY, S.mode);
  } catch (e) {}
}

function explain(e) {
  return explainError(e, 'teacher');
}

function topbar(right = '', sub = '선생님용 · 4차시') {
  return `<header class="topbar">${brandHtml(sub)}<div class="spacer"></div>${right}</header>`;
}

function setLayout(mode) {
  app.classList.toggle('wide', mode === 'board' || mode === 'wide');
  app.classList.toggle('board-mode', mode === 'board');
}

const now = () => (S.cli ? S.cli.serverNow() : Date.now());
const students = () =>
  Object.entries((S.game && S.game.students) || {})
    .filter(([, s]) => !s.out)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
const isFresh = (sid) => S.seen[sid] && now() - S.seen[sid] < SEEN_FRESH_MS;
const imgSrc = (name) => S.cli.getImage(S.code, name);

// ════════════════════════════════════════════════
// 1. 준비 (처음 화면)
// ════════════════════════════════════════════════

async function showHome() {
  closeGame();
  S.view = 'home';
  history.replaceState(null, '', 'teacher.html');
  await loadDraft();
  renderHome();
  loadGameList();
}

function serverNotice() {
  if (!hasServer())
    return `<div class="notice apricot"><div><strong>연습 모드로만 열려요</strong>서버 주소(js/config.js의 SERVER_URL)가 아직 비어 있어요. 이 컴퓨터의 여러 창에서 선생님 화면과 학생 화면을 미리 해 볼 수 있어요.</div></div>`;
  if (S.mode === 'local')
    return `<div class="notice apricot"><div><strong>연습 모드예요</strong>이 컴퓨터의 여러 창에서만 미리 해 볼 수 있어요. 학생 태블릿은 들어올 수 없어요.<div style="margin-top:10px"><button type="button" class="btn btn-cream btn-sm" data-act="mode" data-v="server">수업 모드로 돌아가기</button></div></div></div>`;
  return `<div class="notice green"><div><strong>준비할 것 없이 바로 시작해요</strong>자료를 올리고 게임 코드를 만들면 학생들이 각자 태블릿으로 들어올 수 있어요. 자료와 질문은 게임을 만든 뒤 <b>${KEEP_H}시간</b>이 지나면 저절로 지워지니, 활동이 끝나면 <b>그림 · CSV</b>로 저장해 두세요.<div style="margin-top:10px"><button type="button" class="btn btn-cream btn-sm" data-act="mode" data-v="local">인터넷 없이 이 컴퓨터에서 연습해 보기</button></div></div></div>`;
}

function renderHome() {
  setLayout('normal');
  S.built = 'home';
  const hasDraft = F.title || F.intro || F.materials.length;
  app.innerHTML = `
    ${topbar(`<a class="btn btn-cream btn-sm" href="index.html">${ICON.back}처음으로</a>`)}
    <section class="card pad-lg" aria-labelledby="h">
      <span class="deco green" style="width:260px;height:260px;right:-90px;top:-110px"></span>
      <div class="eyebrow">선생님용 · 활동 준비</div>
      <h1 id="h" style="font-size:clamp(32px,4vw,46px);margin:10px 0 6px">탐구 질문 활동 만들기</h1>
      <p class="section-desc" style="font-size:19px;margin-bottom:20px">우리 반 프로젝트 자료를 올리면, 학생들이 각자 태블릿에서 렌즈로 질문을 연습하고 자료를 보며 탐구 질문을 써요.</p>
      <div id="notice">${serverNotice()}</div>
      ${hasDraft ? `<div class="draft-note"><span>지난번에 만들던 내용을 불러왔어요.</span><button type="button" class="btn btn-ghost btn-sm" data-act="clear-draft">${ICON.refresh}새로 시작하기</button></div>` : ''}
      <div id="setup">${setupHtml()}</div>
      <div class="row create-row">
        <span class="create-sum" id="create-sum"></span>
        <button type="button" class="btn btn-primary btn-lg" data-act="create" id="create-btn">게임 코드 만들기</button>
      </div>
    </section>
    <section class="card pad" style="margin-top:22px" aria-labelledby="rl">
      <h2 class="section-title" id="rl">지난 게임 이어서 하기</h2>
      <p class="section-desc" id="rl-desc"></p>
      <div class="room-list" id="room-list" style="margin-top:14px"><div class="empty-state" style="padding:16px">불러오는 중…</div></div>
    </section>`;
  F.onChange = updateSummary;
  bindSetup($('#setup'));
  updateSummary();
}

function updateSummary() {
  const el = $('#create-sum');
  if (!el) return;
  const bits = [];
  if (S.mode === 'local') bits.push('연습 모드');
  bits.push(`자료 ${F.materials.length}개`);
  bits.push(`렌즈 ${visibleLenses().length}개`);
  bits.push(`연습 그림 ${visiblePictures().length}장`);
  const n = imageCount();
  if (n) bits.push(`올릴 그림 ${n}장`);
  el.textContent = bits.join(' · ');
}

function statusChip(g) {
  if (!g.ready) return '<span class="chip apricot">준비 중</span>';
  if (g.status === 'ended') return '<span class="chip cream">끝 · 질문 보드</span>';
  return '<span class="chip butter">진행 중</span>';
}

function leftLabel(expiresAt) {
  if (!expiresAt) return '';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return '곧 정리돼요';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}분 뒤 정리`;
  return `${h}시간 뒤 정리`;
}

async function loadGameList() {
  const box = $('#room-list');
  if (!box) return;
  const mode = S.mode;
  const desc = $('#rl-desc');
  if (desc) desc.textContent = mode === 'local' ? '이 컴퓨터에서 연습 모드로 만든 게임이에요.' : `이 브라우저에서 만든 게임이에요. 게임을 만든 뒤 ${KEEP_H}시간이 지나면 자료와 질문까지 모두 지워져요.`;
  try {
    const cli = await lensClient(mode);
    const games = await cli.listGames();
    if (!$('#room-list') || S.mode !== mode) return;
    if (!games.length) {
      box.innerHTML = `<div class="empty-state" style="padding:14px">아직 만든 게임이 없어요.</div>`;
      return;
    }
    box.innerHTML = games
      .map((g) => {
        const when = g.createdAt ? new Date(g.createdAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        return `<div class="room-item">
          <span class="rc">${esc(g.code)}</span>
          ${statusChip(g)}
          <span style="color:var(--ink-2);font-weight:700">${esc(g.title)}</span>
          <span style="color:var(--ink-3)">${esc(when)} · 학생 ${g.students}명 · ${esc(leftLabel(g.expiresAt))}</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary btn-sm" data-act="open-room" data-code="${esc(g.code)}">이어서 열기</button>
          <button type="button" class="btn btn-danger btn-sm" data-act="del-room" data-code="${esc(g.code)}">${ICON.trash}지우기</button>
        </div>`;
      })
      .join('');
  } catch (e) {
    console.warn(e);
    if ($('#room-list') && S.mode === mode) box.innerHTML = `<div class="notice apricot"><div>${esc(explain(e))}</div></div>`;
  }
}

async function createGame() {
  const bad = problems();
  if (bad.length) return toast(bad[0], 'warn');
  const { cfg, images } = collectForCreate();
  const md = openModal(`<h2>게임을 만드는 중이에요</h2><p id="mk-msg">게임 코드를 만드는 중…</p><div class="progress" aria-hidden="true"><i id="mk-bar" style="width:4%"></i></div>`);
  const set = (msg, pct) => {
    const m = $('#mk-msg', md.el);
    if (m) m.textContent = msg;
    const b = $('#mk-bar', md.el);
    if (b) b.style.width = `${Math.round(pct * 100)}%`;
  };
  let code = null;
  let cli = null;
  try {
    cli = await lensClient(S.mode);
    const res = await cli.createGame(cfg.title);
    code = res.code;
    for (let i = 0; i < images.length; i++) {
      set(`자료 그림 올리는 중 · ${i + 1} / ${images.length}`, 0.08 + (0.84 * i) / Math.max(1, images.length));
      const data = await images[i].get();
      if (!data) throw Object.assign(new Error('자료 그림을 찾지 못했어요. 그 자료를 지우고 다시 올려 주세요.'), { code: 'NO_FILE' });
      await withRetry(() => cli.putImage(code, images[i].name, data));
    }
    set('자료 설정 저장하는 중…', 0.95);
    const game = await withRetry(() => cli.putCfg(code, cfg));
    md.close();
    await openGame(S.mode, code, { cli, game, cfg });
  } catch (e) {
    console.warn(e);
    md.close();
    toast('게임을 만들지 못했어요. ' + (e.code === 'NO_FILE' ? e.message : explain(e)), 'warn');
    if (code && cli) cli.deleteGame(code).catch(() => {});
  }
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!['BUSY', 'TIMEOUT', 'NETWORK', 'SERVER_DOWN', 'NOT_JSON'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

// ════════════════════════════════════════════════
// 게임 열기 · 상태 받아오기
// ════════════════════════════════════════════════

function closeGame() {
  clearTimeout(S.pollTimer);
  if (S.stopConn) S.stopConn();
  unmountBoard();
  Object.assign(S, { pollTimer: null, stopConn: null, code: null, game: null, cfg: null, cfgRev: -1, seen: {}, counts: {}, built: null, studentsSig: '', tab: 'mat', matIdx: 0, page: 0 });
}

async function openGame(mode, code, preset = {}) {
  closeGame();
  app.innerHTML = `<div class="empty-state">게임을 여는 중이에요…</div>`;
  try {
    const cli = preset.cli || (await lensClient(mode));
    const first = preset.game ? { game: preset.game, seen: {}, counts: {} } : await cli.view(code);
    Object.assign(S, { cli, mode, code, game: first.game, seen: first.seen || {}, counts: first.counts || {} });
    if (preset.cfg) {
      S.cfg = preset.cfg;
      S.cfgRev = first.game.cfgRev;
    } else if (first.game.ready) await loadCfg();
    history.replaceState(null, '', `teacher.html?room=${code}&mode=${mode}`);
    S.stopConn = watchConnection(cli);
    render();
    poll();
  } catch (e) {
    console.warn(e);
    toast(explain(e), 'warn');
    showHome();
  }
}

async function loadCfg() {
  const r = await S.cli.getCfg(S.code);
  S.cfg = r.cfg;
  S.cfgRev = r.rev;
}

async function poll() {
  clearTimeout(S.pollTimer);
  if (!S.code) return;
  const code = S.code;
  try {
    const res = await S.cli.view(code);
    if (S.code !== code) return;
    S.game = res.game;
    S.seen = res.seen || {};
    S.counts = res.counts || {};
    if (S.game.ready && S.game.cfgRev !== S.cfgRev) await loadCfg();
    render();
  } catch (e) {
    if (S.code !== code) return;
    if (e.code === 'NO_GAME') {
      toast('게임이 정리되었어요.');
      return showHome();
    }
    if (e.code === 'NOT_OWNER') {
      toast(explain(e), 'warn');
      return showHome();
    }
  } finally {
    if (S.code === code) S.pollTimer = setTimeout(poll, S.cli.pollMs(document.hidden ? 'hidden' : 'teacher'));
  }
}

function render() {
  if (!S.code || !S.game) return;
  if (!S.game.ready || !S.cfg) {
    if (S.built !== 'notready') {
      S.built = 'notready';
      setLayout('normal');
      app.innerHTML = `${topbar(`<button type="button" class="btn btn-cream btn-sm" data-act="home">${ICON.back}게임 목록</button>`)}
        <section class="card pad-lg center-card"><div class="mascot-row">${catSvg(90)}<div class="bubble">자료가 다 올라가지 못한 게임이에요.<br>게임 목록에서 지우고 다시 만들어 주세요.</div></div></section>`;
    }
    return;
  }
  const view = S.game.status === 'ended' ? 'board' : 'live';
  if (view !== S.view) {
    if (S.view === 'board') unmountBoard();
    S.view = view;
    S.built = null;
    window.scrollTo(0, 0);
  }
  if (view === 'live') renderLive();
  else renderBoardView();
}

function joinUrl() {
  const u = new URL('student.html', location.href);
  u.search = '';
  u.searchParams.set('code', S.code);
  Object.entries(S.cli.linkParams()).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

function shortJoin() {
  const u = new URL('student.html', location.href);
  return u.host + u.pathname;
}

function codeTiles(code) {
  return `<div class="code-tiles" aria-label="게임 코드 ${esc(code.split('').join(' '))}">${code
    .split('')
    .map((d) => `<span>${esc(d)}</span>`)
    .join('')}</div>`;
}

// ════════════════════════════════════════════════
// 2. 진행 (전자칠판): 자료 크게 띄우기 · 렌즈 안내판 · 학생 현황
// ════════════════════════════════════════════════

const CHEERS = [
  '렌즈를 바꿔 끼우면 같은 자료에서도 다른 질문이 보여요',
  '렌즈는 골라도 되고, 안 골라도 돼요',
  '자료를 꼼꼼히 살펴보고 궁금한 것을 질문으로 써 봐요',
  '친구 질문은 활동이 끝난 뒤 함께 봐요',
];

function renderLive() {
  if (S.built !== 'live') {
    S.built = 'live';
    S.studentsSig = '';
    setLayout('board');
    app.innerHTML = `
      <header class="topbar">${brandHtml('4차시 · 질문하는 힘 기르기')}<div class="spacer"></div>
        ${S.mode === 'local' ? '<span class="chip apricot">연습 모드</span>' : ''}
        <span class="chip cream live-title">${esc(S.cfg.title || S.game.title)}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="sound" id="sound-btn"></button>
        <button type="button" class="btn btn-cream btn-sm" data-act="home">${ICON.back}게임 목록</button>
      </header>
      <div class="live">
        <section class="card presenter" id="presenter" aria-label="자료와 렌즈 안내판">
          <div class="pr-head">
            <div class="tabs" role="tablist">
              <button type="button" role="tab" data-act="tab" data-v="mat" id="tab-mat">${ICON.image}자료 보기</button>
              <button type="button" role="tab" data-act="tab" data-v="lens" id="tab-lens">${ICON.lens}렌즈 안내판</button>
            </div>
            <div class="spacer"></div>
            <button type="button" class="btn btn-cream btn-sm" data-act="full" id="full-btn">${ICON.full}크게 띄우기</button>
          </div>
          <div class="pr-body" id="pr-body"></div>
        </section>
        <aside class="live-side">
          <div class="card join-mini">
            <div class="jm-top"><div><div class="eyebrow">게임 코드</div>${codeTiles(S.code)}</div>
              ${S.mode !== 'local' ? `<button type="button" class="qr-mini" data-act="join-info" aria-label="입장 QR 크게 보기">${qrSvg(joinUrl())}</button>` : ''}</div>
            <div class="row" style="gap:8px;margin-top:10px">
              ${S.mode !== 'local' ? `<button type="button" class="btn btn-cream btn-sm" data-act="join-info">학생 입장 안내</button>` : `<button type="button" class="btn btn-apricot btn-sm" data-act="open-student">학생 창 열기</button>`}
            </div>
          </div>
          <div class="card st-panel">
            <h2 class="panel-title"><span>학생</span><span class="chip" id="st-count">0명</span><span class="spacer"></span><span class="q-total" id="q-total">질문 0개</span></h2>
            <div class="st-list" id="st-list"></div>
          </div>
        </aside>
      </div>
      <div class="board-foot">
        <div class="cheer">${catSvg(64)}<span class="bubble" id="cheer">${esc(CHEERS[0])}</span></div>
        <div class="spacer"></div>
        <button type="button" class="btn btn-apricot btn-lg" data-act="end">${ICON.flag}활동 종료</button>
      </div>`;
    drawPresenter();
    updateSoundBtn();
  }
  drawStudents();
  const el = $('#cheer');
  if (el) el.textContent = CHEERS[Math.floor((Date.now() / 15000) % CHEERS.length)];
}

function drawStudents() {
  const list = students();
  const sig = JSON.stringify([list.map(([k, s]) => [k, s.name]), S.counts, list.map(([k]) => isFresh(k))]);
  if (sig === S.studentsSig) return;
  S.studentsSig = sig;
  const total = list.reduce((n, [k]) => n + (S.counts[k] || 0), 0);
  $('#st-count').textContent = `${list.length}명`;
  $('#q-total').textContent = `질문 ${total}개`;
  const box = $('#st-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="padding:18px 8px">학생이 코드나 QR로 들어오면<br>여기에 별명이 보여요.</div>`;
    return;
  }
  box.innerHTML = list
    .map(([sid, s]) => {
      const n = S.counts[sid] || 0;
      const fresh = isFresh(sid);
      return `<button type="button" class="st-row" data-act="student" data-sid="${esc(sid)}">
        <span class="dot ${fresh ? '' : 'off'}" title="${fresh ? '연결됨' : '확인 중'}"></span>
        <span class="nm">${esc(s.name)}</span>
        <span class="qn ${n ? '' : 'zero'}">${n}</span>
      </button>`;
    })
    .join('');
}

function mats() {
  return (S.cfg && S.cfg.materials) || [];
}

function drawPresenter() {
  const body = $('#pr-body');
  if (!body) return;
  $('#tab-mat').setAttribute('aria-selected', String(S.tab === 'mat'));
  $('#tab-lens').setAttribute('aria-selected', String(S.tab === 'lens'));
  if (S.tab === 'lens') {
    body.innerHTML = lensBoardHtml();
    return;
  }
  const list = mats();
  if (!list.length) {
    body.innerHTML = `<div class="pr-empty">${catSvg(110)}<div><b>올린 자료가 없어요</b><br>렌즈 안내판을 띄우고 함께 이야기해 보세요.</div></div>`;
    return;
  }
  S.matIdx = Math.max(0, Math.min(list.length - 1, S.matIdx));
  const m = list[S.matIdx];
  body.innerHTML = `
    <div class="pr-strip" role="tablist" aria-label="자료 고르기">${list
      .map(
        (x, i) => `<button type="button" class="pr-th ${i === S.matIdx ? 'on' : ''}" data-act="mat" data-i="${i}" aria-selected="${i === S.matIdx}">
        <span class="pt-img">${matThumbHtml(x)}</span><span class="pt-t">${i + 1}. ${esc(matTitle(x, i))}</span></button>`
      )
      .join('')}</div>
    <div class="pr-stage">
      <div class="pr-title">${matIcon(m.kind)}<b>${esc(matTitle(m, S.matIdx))}</b><span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-icon" data-act="mat-step" data-d="-1" aria-label="앞 자료" ${S.matIdx === 0 ? 'disabled' : ''}>${ICON.left}</button>
        <span class="pr-n">${S.matIdx + 1} / ${list.length}</span>
        <button type="button" class="btn btn-ghost btn-icon" data-act="mat-step" data-d="1" aria-label="다음 자료" ${S.matIdx >= list.length - 1 ? 'disabled' : ''}>${ICON.right}</button></div>
      <div class="pr-content" id="pr-content">${matBodyHtml(m, { page: S.page, big: true })}</div>
    </div>`;
  hydrate(body, imgSrc);
}

function lensBoardHtml() {
  const lenses = (S.cfg && S.cfg.lenses) || [];
  return `<div class="lens-board">
    <div class="lb-head">${lensIcon(40)}<div><b>렌즈를 바꿔 끼우면, 같은 것도 다르게 보여요</b><span>예시 주제: ${esc(LENS_EXAMPLE_TOPIC)}</span></div></div>
    <div class="lb-grid">${lenses
      .map(
        (l) => `<div class="lb-card" style="--lc:${l.color.main};--ls:${l.color.soft};--li:${l.color.ink}">
        <div class="lb-name">${esc(l.name)}</div>
        <div class="lb-desc">${esc(l.desc)}</div>
        <ul>${l.frames.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${l.example ? `<div class="lb-ex">${esc(l.example)}</div>` : ''}
      </div>`
      )
      .join('')}</div></div>`;
}

function toggleFull() {
  const el = $('#presenter');
  if (!el) return;
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (fs) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) req.call(el).catch(() => el.classList.toggle('pseudo-full'));
  else el.classList.toggle('pseudo-full');
}

document.addEventListener('fullscreenchange', () => {
  const b = $('#full-btn');
  if (b) b.innerHTML = document.fullscreenElement ? `${ICON.x}작게 보기` : `${ICON.full}크게 띄우기`;
});

function joinInfo() {
  const m = openModal(`<div class="join-big">
      <div class="eyebrow" style="text-align:center">게임 코드</div>
      ${codeTiles(S.code)}
      <div class="qr-box big">${qrSvg(joinUrl())}</div>
      <p class="join-url">태블릿으로 QR을 찍거나<br><b>${esc(shortJoin())}</b> 에서 코드를 입력해요</p>
      <div class="actions" style="justify-content:center"><button type="button" class="btn btn-cream" data-act="copy-link">${ICON.copy}입장 링크 복사</button><button type="button" class="btn btn-primary" data-close>닫기</button></div>
    </div>`, { wide: true });
  m.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) m.close();
    if (e.target.closest('[data-act=copy-link]')) toast((await copyText(joinUrl())) ? '입장 링크를 복사했어요.' : '복사하지 못했어요.', 'good');
  });
}

function studentMenu(sid) {
  const s = S.game.students[sid];
  if (!s) return;
  const m = openModal(`<h2>${esc(s.name)}</h2>
    <p>지금까지 쓴 질문 <b>${S.counts[sid] || 0}개</b></p>
    <p style="font-size:16px;color:var(--ink-3)">별명을 잘못 썼거나 다른 태블릿으로 바꿔야 할 때 연결을 풀어요. 연결을 풀어도 이 학생이 쓴 질문은 보드에 남아요.</p>
    <div class="actions"><button type="button" class="btn btn-danger" data-release>연결 풀기</button><button type="button" class="btn btn-cream" data-close>닫기</button></div>`);
  m.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-release]')) {
      m.close();
      try {
        S.game = await S.cli.release(S.code, sid);
        S.studentsSig = '';
        render();
        toast(`${s.name} 연결을 풀었어요.`, 'good');
      } catch (err) {
        toast(explain(err), 'warn');
      }
    } else if (e.target.closest('[data-close]')) m.close();
  });
}

async function endActivity() {
  const total = Object.values(S.counts).reduce((a, b) => a + b, 0);
  const ok = await confirmBox({
    title: '활동을 끝낼까요?',
    body: `학생들은 더 이상 질문을 고칠 수 없어요. 지금까지 쓴 질문 <b>${total}개</b>가 <b>우리 반 탐구 질문 보드</b>에 모여요.`,
    ok: '활동 종료',
  });
  if (!ok) return;
  try {
    S.game = await S.cli.stage(S.code, 'end');
    if (isSoundOn('teacher')) bell({ strikes: 2, gap: 0.45 });
    flashBanner('활동 끝!', '우리 반 탐구 질문 보드를 함께 봐요', 1800);
    render();
  } catch (e) {
    toast('끝내지 못했어요. ' + explain(e), 'warn');
  }
}

async function reopen() {
  const ok = await confirmBox({
    title: '활동을 다시 열까요?',
    body: '학생들이 다시 질문을 쓰고 고칠 수 있어요. 지금까지 정리한 보드는 그대로 남아 있어요.',
    ok: '다시 열기',
  });
  if (!ok) return;
  try {
    S.game = await S.cli.stage(S.code, 'reopen');
    render();
  } catch (e) {
    toast(explain(e), 'warn');
  }
}

function updateSoundBtn() {
  const b = $('#sound-btn');
  if (!b) return;
  const on = isSoundOn('teacher');
  b.innerHTML = `${on ? SOUND_ICON.on : SOUND_ICON.off}${on ? '소리 켜짐' : '소리 꺼짐'}`;
  b.setAttribute('aria-pressed', String(on));
}

// ════════════════════════════════════════════════
// 3. 우리 반 탐구 질문 보드 (board.js)
// ════════════════════════════════════════════════

function renderBoardView() {
  if (S.built === 'board') return;
  S.built = 'board';
  setLayout('board');
  app.innerHTML = `<div class="empty-state">질문을 모으는 중이에요…</div>`;
  mountBoard(app, {
    cli: S.cli,
    code: S.code,
    cfg: S.cfg,
    mode: S.mode,
    getGame: () => S.game,
    onReopen: reopen,
    onHome: showHome,
    brand: brandHtml('4차시 · 질문하는 힘 기르기'),
  });
}

// ════════════════════════════════════════════════
// 클릭 처리
// ════════════════════════════════════════════════

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  unlockAudio();
  switch (el.dataset.act) {
    case 'mode':
      setMode(el.dataset.v);
      renderHome();
      loadGameList();
      break;
    case 'clear-draft': {
      const ok = await confirmBox({ title: '새로 시작할까요?', body: '프로젝트 이름과 올린 자료를 비워요. 렌즈와 연습 그림 설정은 그대로 남아요.', ok: '새로 시작하기', danger: true });
      if (!ok) return;
      await clearDraft();
      renderHome();
      loadGameList();
      break;
    }
    case 'create':
      createGame();
      break;
    case 'open-room':
      openGame(S.mode, el.dataset.code);
      break;
    case 'del-room': {
      const code = el.dataset.code;
      const ok = await confirmBox({ title: `${code} 게임을 지울까요?`, body: '학생 질문과 보드, 올린 자료가 모두 지워져요. 필요한 것은 먼저 그림 · CSV로 저장해 두세요.', ok: '지우기', danger: true });
      if (!ok) return;
      try {
        const cli = await lensClient(S.mode);
        await cli.deleteGame(code);
        toast('게임을 지웠어요.', 'good');
      } catch (err) {
        toast(explain(err), 'warn');
      }
      loadGameList();
      break;
    }
    case 'home':
      showHome();
      break;
    case 'tab':
      S.tab = el.dataset.v;
      drawPresenter();
      break;
    case 'mat':
      S.matIdx = Number(el.dataset.i);
      S.page = 0;
      drawPresenter();
      break;
    case 'mat-step':
      S.matIdx += Number(el.dataset.d);
      S.page = 0;
      drawPresenter();
      break;
    case 'pdf-prev':
    case 'pdf-next': {
      const m = mats()[S.matIdx];
      if (!m) return;
      S.page = Math.max(0, Math.min((m.pages || []).length - 1, S.page + (el.dataset.act === 'pdf-next' ? 1 : -1)));
      const c = $('#pr-content');
      c.innerHTML = matBodyHtml(m, { page: S.page, big: true });
      hydrate(c, imgSrc);
      break;
    }
    case 'full':
      toggleFull();
      break;
    case 'join-info':
      joinInfo();
      break;
    case 'open-student':
      window.open(joinUrl(), '_blank');
      break;
    case 'student':
      studentMenu(el.dataset.sid);
      break;
    case 'end':
      endActivity();
      break;
    case 'sound':
      setSoundOn('teacher', !isSoundOn('teacher'));
      updateSoundBtn();
      break;
    default:
  }
});

// 자료 그림을 누르면 크게 보기
app.addEventListener('click', (e) => {
  const img = e.target.closest('img[data-zoom]');
  if (!img || !img.src || document.fullscreenElement) return;
  const m = openModal(`<img src="${img.src}" alt="${esc(img.alt)}" class="zoom-img"><div class="actions" style="margin-top:12px"><button type="button" class="btn btn-cream" data-close>닫기</button></div>`, { wide: true, cls: 'zoom-modal' });
  m.el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-close]')) m.close();
  });
});

// ── 시작 ─────────────────────────────────────────────
(async function start() {
  pruneImageCache();
  const p = new URLSearchParams(location.search);
  const room = p.get('room');
  if (room && /^\d{4}$/.test(room)) {
    const mode = p.get('mode') === 'local' || !hasServer() ? 'local' : 'server';
    setMode(mode);
    await loadDraft();
    return openGame(mode, room);
  }
  showHome();
})();

// 활동이 끝난 뒤 선생님 화면
//  ① 우리 반 탐구 질문 보드: 모든 학생 질문이 카드로 펼쳐진다.
//     끌어 옮기기 · 눌러서 고르기 · 묶음 상자 · 하나로 합치기 · 렌즈 붙이기 · 고치기 · 지우기(되살리기) · 별표 · 되돌리기
//     빈 곳을 끌면 보드가 움직이고, 휠 · 두 손가락 · 버튼으로 크게/작게 본다.
//  ② 프로젝트 탐구 질문: 「개념적 렌즈 - 탐구 질문」 쌍 (기본 3칸, 더하고 빼고 순서 바꾸기)
//  보드는 서버에 저절로 저장되고(조금 뒤에 한 번), 그림(PNG) · 인쇄 · CSV로 내려받는다.

import { $, esc, toast, openModal, confirmBox, downloadText, csvCell, catSvg, ICON } from './ui.js';
import { lensById, NO_LENS, uid } from './lenses.js';
import { matTitle } from './materials.js';
import { enableDnd } from './dnd.js';

const CARD_W = 230;
const GAP = 14;
const PAD = 16;
const HEAD = 54;
const SAVE_MS = 1200;
const FAST_ITEMS_MS = 90000;
const UNDO_MAX = 40;
const Z_MIN = 0.2;
const Z_MAX = 2;
const FONT = "'Dunggeunmiso', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

let B = null;

export function unmountBoard() {
  if (!B) return;
  clearTimeout(B.saveTimer);
  clearTimeout(B.itemsTimer);
  if (B.dirty) saveNow();
  window.removeEventListener('resize', B.onResize);
  window.removeEventListener('beforeunload', B.onUnload);
  document.removeEventListener('keydown', B.onKey);
  B = null;
}

export async function mountBoard(app, ctx) {
  unmountBoard();
  const me = {
    ...ctx,
    app,
    items: {},
    board: null,
    view: 'board',
    sel: [],
    showNames: false,
    filter: 'all',
    z: 1,
    tx: 40,
    ty: 30,
    undo: [],
    saveTimer: null,
    saving: false,
    dirty: false,
    saveErr: false,
    itemsTimer: null,
    since: Date.now(),
    h: {},
    pairSel: null,
    trashOpen: false,
    ptrs: new Map(),
    drag: null,
    lenses: (ctx.cfg && ctx.cfg.lenses) || [],
    mats: (ctx.cfg && ctx.cfg.materials) || [],
  };
  B = me;
  let board = null;
  let items = {};
  try {
    [board, items] = await Promise.all([ctx.cli.boardGet(ctx.code), ctx.cli.items(ctx.code)]);
  } catch (e) {
    if (B !== me) return;
    app.innerHTML = `<header class="topbar">${ctx.brand}<div class="spacer"></div><button type="button" class="btn btn-cream btn-sm" data-act="b-home">${ICON.back}게임 목록</button></header>
      <section class="card pad-lg center-card"><div class="mascot-row">${catSvg(90)}<div class="bubble">질문을 불러오지 못했어요.<br>${esc(ctx.cli.explain(e, 'teacher'))}</div></div>
      <div class="row" style="justify-content:center;margin-top:16px"><button type="button" class="btn btn-primary" data-act="b-retry">다시 불러오기</button></div></section>`;
    app.onclick = (ev) => {
      const el = ev.target.closest('[data-act]');
      if (!el) return;
      app.onclick = null;
      if (el.dataset.act === 'b-retry') mountBoard(app, ctx);
      else ctx.onHome();
    };
    return;
  }
  if (B !== me) return;
  // 처음 여는 보드인지는 그리기 전에 본다 (그리면서 카드 자리가 생기기 때문)
  const fresh = !board || !board.cards || !Object.keys(board.cards).length;
  B.board = normalizeBoard(board);
  setItems(items);
  ensureCards();
  build();
  drawWorld();
  if (fresh) {
    layoutByLens();
    if (Object.keys(B.items).length) B.dirty = true;
  } else placeNew();
  fitView();
  if (B.dirty) scheduleSave();
  B.onResize = () => {
    if (B && B.view === 'board') applyView();
  };
  B.onUnload = (e) => {
    if (B && (B.dirty || B.saving)) {
      saveNow();
      e.preventDefault();
      e.returnValue = '';
    }
  };
  B.onKey = onKey;
  window.addEventListener('resize', B.onResize);
  window.addEventListener('beforeunload', B.onUnload);
  document.addEventListener('keydown', B.onKey);
  B.itemsTimer = setTimeout(pollItems, ctx.cli.pollMs('items'));
}

function normalizeBoard(b) {
  const out = { v: 1, cards: {}, groups: {}, pairs: [], seq: 0 };
  if (b && typeof b === 'object') {
    if (b.cards && typeof b.cards === 'object') out.cards = b.cards;
    if (b.groups && typeof b.groups === 'object') out.groups = b.groups;
    if (Array.isArray(b.pairs)) out.pairs = b.pairs.filter((p) => p && p.id);
    out.seq = Number(b.seq) || 0;
  }
  if (!b || !Array.isArray(b.pairs)) out.pairs = [newPair(), newPair(), newPair()];
  return out;
}

function newPair() {
  return { id: uid('r'), lens: '', text: '', from: '' };
}

// ── 질문 · 카드 ─────────────────────────────────────

function studentName(sid) {
  const g = B.getGame();
  return (g && g.students && g.students[sid] && g.students[sid].name) || '학생';
}

// 서버 질문 { 학생: [질문] } → B.items { 열쇠: 질문 }. 새로 들어온 열쇠 목록을 돌려준다
function setItems(map) {
  const next = {};
  Object.entries(map || {}).forEach(([sid, list]) =>
    (list || []).forEach((q) => {
      const key = `${sid}:${q.id}`;
      next[key] = { ...q, sid, key, name: studentName(sid) };
    })
  );
  const added = Object.keys(next).filter((k) => !B.items[k]);
  const changed = Object.keys(next).some((k) => B.items[k] && (B.items[k].text !== next[k].text || B.items[k].lens !== next[k].lens));
  const removed = Object.keys(B.items).some((k) => !next[k]);
  B.items = next;
  return { added, changed: changed || removed };
}

const card = (k) => B.board.cards[k] || (B.board.cards[k] = { x: 0, y: 0 });
const item = (k) => B.items[k];
function lensOf(k) {
  const c = B.board.cards[k];
  if (c && c.lens !== undefined && c.lens !== null) return c.lens;
  return (item(k) && item(k).lens) || '';
}
function textOf(k) {
  const c = B.board.cards[k];
  return (c && c.text) || (item(k) && item(k).text) || '';
}
const isVisible = (k) => item(k) && !card(k).del && !card(k).into;
const visibleKeys = () => Object.keys(B.items).filter(isVisible).sort((a, b) => (item(a).at || 0) - (item(b).at || 0));
const childrenOf = (k) => Object.keys(B.items).filter((x) => B.board.cards[x] && B.board.cards[x].into === k);
const lensInfo = (id) => (id ? lensById(B.lenses, id) : NO_LENS);
function lensOrder() {
  const ids = B.lenses.map((l) => l.id);
  visibleKeys().forEach((k) => {
    const id = lensOf(k);
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids.concat(['']);
}
const matName = (id) => {
  const i = B.mats.findIndex((m) => m.id === id);
  return i >= 0 ? matTitle(B.mats[i], i) : '';
};

function ensureCards() {
  Object.keys(B.items).forEach((k) => card(k));
}

// ── 화면 뼈대 ───────────────────────────────────────

function build() {
  const g = B.getGame();
  B.app.innerHTML = `
    <header class="topbar bv-top">${B.brand}<div class="spacer"></div>
      <div class="tabs bv-tabs" role="tablist">
        <button type="button" role="tab" data-act="b-view" data-v="board" id="bv-t1">${ICON.board}우리 반 질문 보드</button>
        <button type="button" role="tab" data-act="b-view" data-v="pairs" id="bv-t2">${ICON.lens}프로젝트 탐구 질문</button>
      </div>
      <div class="spacer"></div>
      <span class="save-state" id="b-save" aria-live="polite"></span>
      ${B.mode === 'local' ? '<span class="chip apricot">연습 모드</span>' : ''}
      <button type="button" class="btn btn-cream btn-sm" data-act="b-reopen" title="학생들이 다시 질문을 쓸 수 있게 해요">${ICON.play}다시 열기</button>
      <button type="button" class="btn btn-cream btn-sm" data-act="b-home">${ICON.back}게임 목록</button>
    </header>
    <div class="bv-root" id="bv-root">
      <section class="bv-board" id="bv-board">
        <div class="bt-bar card">
          <span class="bt-sum" id="bt-sum"></span>
          <button type="button" class="btn btn-cream btn-sm" data-act="b-layout">${ICON.layout}렌즈별로 펼치기</button>
          <button type="button" class="btn btn-cream btn-sm" data-act="b-group-new">${ICON.group}묶음 상자</button>
          <label class="bt-filter"><span>보기</span><select id="bt-filter" aria-label="보기"></select></label>
          <button type="button" class="btn btn-ghost btn-sm" data-act="b-names" id="b-names" aria-pressed="false">${ICON.eye}이름 보기</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="b-trash" id="b-trash">${ICON.trash}지운 질문</button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="b-undo" id="b-undo" disabled>${ICON.undo}되돌리기</button>
          <button type="button" class="btn btn-cream btn-sm" data-act="b-export">${ICON.download}내려받기</button>
        </div>
        <div class="bcanvas" id="bcanvas">
          <div class="bworld" id="bworld"></div>
          <div class="bt-sel hidden" id="bt-sel" role="toolbar" aria-label="고른 카드"></div>
          <div class="bt-zoom">
            <button type="button" class="btn btn-cream btn-icon" data-act="b-zoom" data-d="-1" aria-label="작게 보기">${ICON.zoomOut}</button>
            <span id="zoom-n">100%</span>
            <button type="button" class="btn btn-cream btn-icon" data-act="b-zoom" data-d="1" aria-label="크게 보기">${ICON.zoomIn}</button>
            <button type="button" class="btn btn-cream btn-sm" data-act="b-fit">${ICON.fit}전체 보기</button>
          </div>
          <div class="b-help" id="b-help">카드를 <b>끌어</b> 옮기고, <b>눌러서</b> 여러 장 골라 묶거나 합쳐요. 빈 곳을 끌면 보드가 움직여요.</div>
          <aside class="trash hidden" id="trash" aria-label="지운 질문"></aside>
        </div>
      </section>
      <section class="bv-pairs hidden" id="bv-pairs">
        <div class="pairs">
          <section class="card pc-cand" aria-label="질문 고르기">
            <div class="pc-head"><h2>질문 고르기</h2><span class="spacer"></span><select id="pc-filter" aria-label="질문 거르기"></select></div>
            <input class="input" id="pc-search" placeholder="낱말로 찾기" autocomplete="off">
            <p class="pc-help">질문을 오른쪽 칸으로 <b>끌어다 놓거나</b>, 눌러서 고른 뒤 칸을 눌러요.</p>
            <div class="pc-list" id="pc-list" data-scroll-list></div>
          </section>
          <section class="card pm" aria-label="프로젝트 탐구 질문">
            <div class="pm-head">
              <div><div class="eyebrow">우리 반 · ${esc(g.title || '')}</div><h2>프로젝트 탐구 질문</h2></div>
              <span class="spacer"></span>
              <button type="button" class="btn btn-cream btn-sm" data-act="p-png">${ICON.image}그림 저장</button>
              <button type="button" class="btn btn-cream btn-sm" data-act="p-print">${ICON.print}인쇄</button>
              <button type="button" class="btn btn-cream btn-sm" data-act="p-csv">${ICON.download}CSV</button>
            </div>
            <div class="pm-cols" aria-hidden="true"><span></span><span>개념적 렌즈</span><span></span><span>탐구 질문</span><span></span></div>
            <div class="pm-rows" id="pm-rows"></div>
            <button type="button" class="btn btn-cream pm-add" data-act="p-add">${ICON.plus}칸 더하기</button>
          </section>
        </div>
      </section>
    </div>`;
  const root = $('#bv-root');
  B.app.onclick = onClick;
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.bcard');
    if (c) editCard(c.dataset.key);
    const g2 = e.target.closest('[data-gdrag]');
    if (g2) editGroup(g2.dataset.gdrag);
  });
  const cv = $('#bcanvas');
  cv.addEventListener('pointerdown', canvasDown);
  cv.addEventListener('pointermove', canvasMove);
  cv.addEventListener('pointerup', canvasUp);
  cv.addEventListener('pointercancel', canvasUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  enableDnd($('#bv-pairs'), {
    onDrop: (key, zone) => putPair(key, zone),
    onTap: (key) => {
      B.pairSel = B.pairSel === key ? null : key;
      drawCandidates();
      if (B.pairSel) toast('넣을 칸을 눌러요.');
    },
    onZoneTap: (zone) => {
      if (B.pairSel) putPair(B.pairSel, zone);
    },
  });
  drawFilter();
  showView('board');
  drawSaveState();
}

function showView(v) {
  B.view = v;
  $('#bv-t1').setAttribute('aria-selected', String(v === 'board'));
  $('#bv-t2').setAttribute('aria-selected', String(v === 'pairs'));
  $('#bv-board').classList.toggle('hidden', v !== 'board');
  $('#bv-pairs').classList.toggle('hidden', v !== 'pairs');
  if (v === 'board') {
    drawWorld();
    applyView();
  } else {
    B.pairSel = null;
    drawCandidates();
    drawPairs();
  }
}

function drawFilter() {
  const opts = [`<option value="all">모든 질문</option>`, `<option value="star">별표한 질문</option>`]
    .concat(lensOrder().map((id) => `<option value="lens:${esc(id)}">${esc(lensInfo(id).name)}</option>`))
    .join('');
  ['#bt-filter', '#pc-filter'].forEach((s) => {
    const el = $(s);
    if (!el) return;
    const cur = el.value || (s === '#bt-filter' ? B.filter : 'all');
    el.innerHTML = opts;
    el.value = [...el.options].some((o) => o.value === cur) ? cur : 'all';
  });
}

function passes(k, f) {
  if (f === 'all') return true;
  if (f === 'star') return !!card(k).star;
  if (f.startsWith('lens:')) return lensOf(k) === f.slice(5);
  return true;
}

// ── 보드 그리기 ─────────────────────────────────────

function cardHtml(k) {
  const q = item(k);
  const c = card(k);
  const L = lensInfo(lensOf(k));
  const kids = childrenOf(k).filter((x) => !card(x).del).length;
  const dim = !passes(k, B.filter);
  const sel = B.sel.includes(k);
  const meta = [B.showNames ? q.name : '', q.mat ? matName(q.mat) : ''].filter(Boolean).join(' · ');
  const fresh = c.fresh && Date.now() - c.fresh < 180000;
  return `<div class="bcard ${sel ? 'sel' : ''} ${dim ? 'dim' : ''}" data-key="${esc(k)}" style="left:${Math.round(c.x)}px;top:${Math.round(c.y)}px;--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}">
    <div class="bc-top"><span class="bc-lens">${esc(L.name)}</span>${c.star ? `<span class="bc-star">${ICON.star}</span>` : ''}${fresh ? '<span class="bc-new">새</span>' : ''}<span class="spacer"></span>${kids ? `<span class="bc-merged" title="합친 질문">+${kids}</span>` : ''}<button type="button" class="bc-btn" data-act="b-card" data-key="${esc(k)}" aria-label="카드 고치기">${ICON.edit}</button></div>
    <div class="bc-text">${esc(textOf(k))}</div>
    <div class="bc-meta">${esc(meta)}${c.text ? '<span class="bc-edited">고침</span>' : ''}</div>
  </div>`;
}

function groupHtml(id, g) {
  const n = keysInGroup(id).length;
  return `<div class="bgroup" data-gid="${esc(id)}" style="left:${Math.round(g.x)}px;top:${Math.round(g.y)}px;width:${Math.round(g.w)}px;height:${Math.round(g.h)}px;--gc:${g.color || '#d9cdb8'}">
    <div class="bg-head" data-gdrag="${esc(id)}"><span class="bg-title">${esc(g.title || '묶음')}</span><span class="bg-n">${n}</span><span class="spacer"></span><button type="button" class="bc-btn" data-act="b-gzoom" data-gid="${esc(id)}" aria-label="이 상자 크게 보기" title="이 상자 크게 보기">${ICON.zoomIn}</button><button type="button" class="bc-btn" data-act="b-group" data-gid="${esc(id)}" aria-label="묶음 고치기">${ICON.edit}</button></div>
    <div class="bg-resize" data-gresize="${esc(id)}" aria-hidden="true"></div>
  </div>`;
}

function drawWorld() {
  if (!B || !$('#bworld')) return;
  const world = $('#bworld');
  const keys = visibleKeys();
  const groups = Object.entries(B.board.groups);
  world.innerHTML = groups.map(([id, g]) => groupHtml(id, g)).join('') + keys.map(cardHtml).join('');
  world.querySelectorAll('.bcard').forEach((el) => (B.h[el.dataset.key] = el.offsetHeight || B.h[el.dataset.key] || 90));
  // 묶음 상자 안 개수는 카드 높이를 잰 뒤에 다시 센다
  world.querySelectorAll('.bgroup').forEach((el) => {
    const n = el.querySelector('.bg-n');
    if (n) n.textContent = keysInGroup(el.dataset.gid).length;
  });
  if (!keys.length && !groups.length)
    world.innerHTML = `<div class="b-empty">${catSvg(110)}<div><b>모인 질문이 없어요</b><br>학생들이 질문을 쓰지 않았거나 아직 보내는 중이에요.<br>[다시 열기]로 활동을 이어 갈 수 있어요.</div></div>`;
  drawSummary();
  drawSelBar();
  if (B.trashOpen) drawTrash();
}

function drawSummary() {
  const keys = visibleKeys();
  const sids = new Set(Object.values(B.items).map((q) => q.sid));
  const stars = keys.filter((k) => card(k).star).length;
  const el = $('#bt-sum');
  if (el) el.innerHTML = `질문 <b>${keys.length}</b>개 · 쓴 학생 ${sids.size}명${stars ? ` · ${ICON.star}${stars}` : ''}`;
  const del = Object.keys(B.items).filter((k) => card(k).del).length;
  const tb = $('#b-trash');
  if (tb) tb.innerHTML = `${ICON.trash}지운 질문${del ? ` ${del}` : ''}`;
  const ub = $('#b-undo');
  if (ub) ub.disabled = !B.undo.length;
  const nb = $('#b-names');
  if (nb) {
    nb.setAttribute('aria-pressed', String(B.showNames));
    nb.innerHTML = B.showNames ? `${ICON.eyeOff}이름 숨기기` : `${ICON.eye}이름 보기`;
  }
}

function drawSelBar() {
  const bar = $('#bt-sel');
  if (!bar) return;
  B.sel = B.sel.filter(isVisible);
  if (!B.sel.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  const n = B.sel.length;
  const allStar = B.sel.every((k) => card(k).star);
  bar.innerHTML = `<b>${n}장 골랐어요</b>
    <select id="sel-lens" aria-label="렌즈 붙이기"><option value="__">렌즈 붙이기…</option>${lensOrder()
      .map((id) => `<option value="${esc(id)}">${esc(lensInfo(id).name)}</option>`)
      .join('')}</select>
    <button type="button" class="btn btn-cream btn-sm" data-act="b-sel-group">${ICON.group}묶음 상자로</button>
    <button type="button" class="btn btn-cream btn-sm" data-act="b-sel-merge" ${n < 2 ? 'disabled' : ''} title="비슷한 질문을 한 장으로 합쳐요">${ICON.merge}하나로 합치기</button>
    <button type="button" class="btn btn-cream btn-sm" data-act="b-sel-star">${allStar ? ICON.starLine + '별표 빼기' : ICON.star + '별표'}</button>
    <button type="button" class="btn btn-ghost btn-sm" data-act="b-sel-del">${ICON.trash}지우기</button>
    <button type="button" class="btn btn-ghost btn-sm" data-act="b-sel-clear">${ICON.x}고르기 풀기</button>`;
}

function applyView() {
  const w = $('#bworld');
  if (!w) return;
  w.style.transform = `translate(${B.tx}px, ${B.ty}px) scale(${B.z})`;
  const n = $('#zoom-n');
  if (n) n.textContent = `${Math.round(B.z * 100)}%`;
}

function contentBox() {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  visibleKeys().forEach((k) => {
    const c = card(k);
    x1 = Math.min(x1, c.x);
    y1 = Math.min(y1, c.y);
    x2 = Math.max(x2, c.x + CARD_W);
    y2 = Math.max(y2, c.y + (B.h[k] || 90));
  });
  Object.values(B.board.groups).forEach((g) => {
    x1 = Math.min(x1, g.x);
    y1 = Math.min(y1, g.y);
    x2 = Math.max(x2, g.x + g.w);
    y2 = Math.max(y2, g.y + g.h);
  });
  if (x1 === Infinity) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function fitView() {
  const cv = $('#bcanvas');
  if (!cv) return;
  const box = contentBox();
  const cw = cv.clientWidth;
  const ch = cv.clientHeight;
  if (!box || !cw) {
    B.z = 1;
    B.tx = 40;
    B.ty = 30;
  } else {
    B.z = Math.max(Z_MIN, Math.min(1.1, (cw - 60) / box.w, (ch - 110) / box.h));
    B.tx = (cw - box.w * B.z) / 2 - box.x * B.z;
    B.ty = Math.max(70, (ch - box.h * B.z) / 2) - box.y * B.z;
  }
  applyView();
}

// 묶음 상자 하나를 화면에 크게 (함께 읽을 때)
function zoomToGroup(gid) {
  const g = B.board.groups[gid];
  const cv = $('#bcanvas');
  if (!g || !cv) return;
  const cw = cv.clientWidth;
  const ch = cv.clientHeight;
  B.z = Math.max(Z_MIN, Math.min(1.3, (cw - 80) / g.w, (ch - 150) / g.h));
  B.tx = (cw - g.w * B.z) / 2 - g.x * B.z;
  B.ty = Math.max(70, (ch - g.h * B.z) / 2) - g.y * B.z;
  applyView();
}

function zoomAt(sx, sy, factor) {
  const r = $('#bcanvas').getBoundingClientRect();
  const z1 = Math.max(Z_MIN, Math.min(Z_MAX, B.z * factor));
  const wx = (sx - r.left - B.tx) / B.z;
  const wy = (sy - r.top - B.ty) / B.z;
  B.tx = sx - r.left - wx * z1;
  B.ty = sy - r.top - wy * z1;
  B.z = z1;
  applyView();
}

// ── 묶음 상자 ───────────────────────────────────────

function keysInGroup(gid) {
  const g = B.board.groups[gid];
  if (!g) return [];
  return visibleKeys().filter((k) => {
    const c = card(k);
    const cx = c.x + CARD_W / 2;
    const cy = c.y + (B.h[k] || 90) / 2;
    return cx >= g.x && cx <= g.x + g.w && cy >= g.y + 20 && cy <= g.y + g.h;
  });
}

function groupOfKey(k) {
  const c = card(k);
  const cx = c.x + CARD_W / 2;
  const cy = c.y + (B.h[k] || 90) / 2;
  const hit = Object.entries(B.board.groups).filter(([, g]) => cx >= g.x && cx <= g.x + g.w && cy >= g.y + 20 && cy <= g.y + g.h);
  if (!hit.length) return null;
  hit.sort((a, b) => a[1].w * a[1].h - b[1].w * b[1].h);
  return hit[0];
}

// 카드들을 상자 안에 줄 맞춰 놓고 상자 크기를 맞춘다
function packInto(keys, x, y, title, color, gid = uid('g')) {
  const cols = keys.length <= 4 ? 1 : keys.length <= 12 ? 2 : 3;
  const colH = Array(cols).fill(0);
  keys.forEach((k) => {
    let c = 0;
    for (let i = 1; i < cols; i++) if (colH[i] < colH[c]) c = i;
    const cd = card(k);
    cd.x = x + PAD + c * (CARD_W + GAP);
    cd.y = y + HEAD + colH[c];
    cd.placed = 1;
    colH[c] += (B.h[k] || 90) + GAP;
  });
  const w = PAD * 2 + cols * CARD_W + (cols - 1) * GAP;
  const h = Math.max(150, HEAD + Math.max(0, ...colH) - GAP + PAD + 6);
  B.board.groups[gid] = { x, y, w, h, title, color };
  return B.board.groups[gid];
}

// 렌즈마다 묶음 상자를 만들어 카드를 나눠 놓는다.
// 상자를 몇 줄로 늘어놓을지는 보드 화면 모양(가로:세로)에 가장 크게 보이도록 고른다.
function layoutByLens() {
  const keys = visibleKeys();
  B.board.groups = {};
  const sets = lensOrder()
    .map((id) => ({ id, ks: keys.filter((k) => lensOf(k) === id) }))
    .filter((s) => s.ks.length);
  // 상자 크기 미리 재기
  sets.forEach((s) => {
    s.cols = s.ks.length <= 4 ? 1 : s.ks.length <= 12 ? 2 : 3;
    s.w = PAD * 2 + s.cols * CARD_W + (s.cols - 1) * GAP;
    const colH = Array(s.cols).fill(0);
    s.ks.forEach((k) => {
      let c = 0;
      for (let i = 1; i < s.cols; i++) if (colH[i] < colH[c]) c = i;
      colH[c] += (B.h[k] || 90) + GAP;
    });
    s.h = Math.max(150, HEAD + Math.max(0, ...colH) - GAP + PAD + 6);
  });
  const cv = $('#bcanvas');
  const cw = (cv && cv.clientWidth) || 1300;
  const ch = Math.max(200, ((cv && cv.clientHeight) || 600) - 110);
  const place = (maxW) => {
    let x = 0;
    let y = 0;
    let rowH = 0;
    let W = 0;
    const pos = sets.map((s) => {
      if (x > 0 && x + s.w > maxW) {
        x = 0;
        y += rowH + 50;
        rowH = 0;
      }
      const p = { x, y };
      x += s.w + 40;
      W = Math.max(W, x - 40);
      rowH = Math.max(rowH, s.h);
      return p;
    });
    return { pos, W, H: y + rowH };
  };
  const total = sets.reduce((a, s) => a + s.w + 40, 0);
  let best = null;
  for (let mw = Math.max(0, ...sets.map((s) => s.w)); mw <= total + 40; mw += 120) {
    const r = place(mw);
    const sc = Math.min(cw / Math.max(1, r.W), ch / Math.max(1, r.H));
    if (!best || sc > best.sc + 0.001) best = { ...r, sc };
  }
  sets.forEach((s, i) => {
    const L = lensInfo(s.id);
    packInto(s.ks, best.pos[i].x, best.pos[i].y, L.name, L.color.main, 'g-' + (s.id || 'none'));
  });
  drawWorld();
}

// 새로 들어온 질문: 보드 오른쪽 「새로 들어온 질문」 상자에 넣는다
function placeNew() {
  const fresh = Object.keys(B.items).filter((k) => !B.board.cards[k] || !B.board.cards[k].placed);
  if (!fresh.length) return false;
  fresh.forEach((k) => (card(k).fresh = Date.now()));
  drawWorld();
  const box = contentBox();
  const inbox = B.board.groups.inbox;
  const others = visibleKeys().filter((k) => !fresh.includes(k));
  if (inbox) {
    const ks = keysInGroup('inbox').filter((k) => !fresh.includes(k)).concat(fresh.filter(isVisible));
    packInto(ks, inbox.x, inbox.y, inbox.title, inbox.color, 'inbox');
  } else {
    const x = box && others.length ? box.x + box.w + 60 : 0;
    const y = box && others.length ? box.y : 0;
    packInto(fresh.filter(isVisible), x, y, '새로 들어온 질문', '#e98d64', 'inbox');
  }
  fresh.forEach((k) => (card(k).placed = 1));
  B.dirty = true;
  drawWorld();
  return true;
}

// ── 손가락 · 마우스 ─────────────────────────────────

function canvasDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('button, select, input, textarea, a, .bt-zoom, .trash, .bt-sel, .b-help')) return;
  const cv = $('#bcanvas');
  B.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    cv.setPointerCapture(e.pointerId);
  } catch (err) {}
  if (B.ptrs.size === 2) {
    const [a, b] = [...B.ptrs.values()];
    B.drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z0: B.z, tx0: B.tx, ty0: B.ty };
    return;
  }
  if (B.ptrs.size > 2) return;
  const start = { x: e.clientX, y: e.clientY };
  const cardEl = e.target.closest('.bcard');
  const gr = e.target.closest('[data-gresize]');
  const gd = e.target.closest('[data-gdrag]');
  if (gr) {
    const g = B.board.groups[gr.dataset.gresize];
    B.drag = { mode: 'resize', gid: gr.dataset.gresize, w0: g.w, h0: g.h, start };
  } else if (cardEl) {
    const key = cardEl.dataset.key;
    const keys = B.sel.includes(key) ? B.sel.slice() : [key];
    B.drag = { mode: 'card', key, keys, pos0: keys.map((k) => ({ k, x: card(k).x, y: card(k).y })), start };
  } else if (gd) {
    const gid = gd.dataset.gdrag;
    const g = B.board.groups[gid];
    const members = keysInGroup(gid);
    B.drag = { mode: 'group', gid, g0: { x: g.x, y: g.y }, pos0: members.map((k) => ({ k, x: card(k).x, y: card(k).y })), start };
  } else B.drag = { mode: 'pan', tx0: B.tx, ty0: B.ty, start };
}

function canvasMove(e) {
  if (!B || !B.ptrs.has(e.pointerId)) return;
  B.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const d = B.drag;
  if (!d) return;
  if (d.mode === 'pinch') {
    if (B.ptrs.size < 2) return;
    const [a, b] = [...B.ptrs.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = $('#bcanvas').getBoundingClientRect();
    const z1 = Math.max(Z_MIN, Math.min(Z_MAX, (d.z0 * dist) / d.d0));
    const wx = (d.m0.x - r.left - d.tx0) / d.z0;
    const wy = (d.m0.y - r.top - d.ty0) / d.z0;
    B.z = z1;
    B.tx = mid.x - r.left - wx * z1;
    B.ty = mid.y - r.top - wy * z1;
    applyView();
    return;
  }
  const dx = e.clientX - d.start.x;
  const dy = e.clientY - d.start.y;
  if (!d.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    if (d.mode !== 'pan') {
      pushUndo();
      $('#b-help') && $('#b-help').classList.add('gone');
    }
    if (d.mode === 'card')
      d.keys.forEach((k) => {
        const el = cardEl(k);
        if (el) el.classList.add('dragging');
      });
  }
  e.preventDefault();
  const wx = dx / B.z;
  const wy = dy / B.z;
  if (d.mode === 'pan') {
    B.tx = d.tx0 + dx;
    B.ty = d.ty0 + dy;
    applyView();
  } else if (d.mode === 'card' || d.mode === 'group') {
    d.pos0.forEach((p) => {
      const el = cardEl(p.k);
      if (el) {
        el.style.left = `${Math.round(p.x + wx)}px`;
        el.style.top = `${Math.round(p.y + wy)}px`;
      }
    });
    if (d.mode === 'group') {
      const el = groupEl(d.gid);
      if (el) {
        el.style.left = `${Math.round(d.g0.x + wx)}px`;
        el.style.top = `${Math.round(d.g0.y + wy)}px`;
      }
    } else {
      // 끌고 있는 카드가 들어갈 상자 표시
      const c0 = d.pos0[0];
      const cx = c0.x + wx + CARD_W / 2;
      const cy = c0.y + wy + 30;
      document.querySelectorAll('.bgroup.over').forEach((x) => x.classList.remove('over'));
      const hit = Object.entries(B.board.groups).find(([, g]) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h);
      if (hit) groupEl(hit[0]) && groupEl(hit[0]).classList.add('over');
    }
  } else if (d.mode === 'resize') {
    const el = groupEl(d.gid);
    if (el) {
      el.style.width = `${Math.max(260, Math.round(d.w0 + wx))}px`;
      el.style.height = `${Math.max(140, Math.round(d.h0 + wy))}px`;
    }
  }
}

function canvasUp(e) {
  if (!B) return;
  B.ptrs.delete(e.pointerId);
  const d = B.drag;
  if (!d) return;
  if (d.mode === 'pinch') {
    if (!B.ptrs.size) B.drag = null;
    else {
      const [p] = [...B.ptrs.values()];
      B.drag = { mode: 'pan', tx0: B.tx, ty0: B.ty, start: { x: p.x, y: p.y }, moved: true };
    }
    return;
  }
  B.drag = null;
  document.querySelectorAll('.bgroup.over').forEach((x) => x.classList.remove('over'));
  if (!d.moved) {
    if (e.type === 'pointercancel') return;
    if (d.mode === 'card') toggleSel(d.key);
    else if (d.mode === 'pan' && B.sel.length) {
      B.sel = [];
      drawWorld();
    }
    return;
  }
  if (d.mode === 'pan') return;
  const wx = (e.clientX - d.start.x) / B.z;
  const wy = (e.clientY - d.start.y) / B.z;
  if (d.mode === 'card' || d.mode === 'group') {
    d.pos0.forEach((p) => {
      const c = card(p.k);
      c.x = Math.round(p.x + wx);
      c.y = Math.round(p.y + wy);
      c.placed = 1;
    });
    if (d.mode === 'group') {
      const g = B.board.groups[d.gid];
      g.x = Math.round(d.g0.x + wx);
      g.y = Math.round(d.g0.y + wy);
    }
  } else if (d.mode === 'resize') {
    const g = B.board.groups[d.gid];
    g.w = Math.max(260, Math.round(d.w0 + wx));
    g.h = Math.max(140, Math.round(d.h0 + wy));
  }
  drawWorld();
  scheduleSave();
}

function onWheel(e) {
  if (e.target.closest('.trash')) return;
  e.preventDefault();
  // 마우스 휠은 크게/작게, 노트북 터치패드(두 손가락)는 움직이기, 터치패드 오므리기(ctrl)는 크게/작게
  const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
  if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  else {
    B.tx -= e.deltaX;
    B.ty -= e.deltaY;
    applyView();
  }
}

function onKey(e) {
  if (!B || B.view !== 'board') return;
  if (e.target.closest && e.target.closest('input, textarea, select, .modal')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && B.sel.length) {
    e.preventDefault();
    delSelected();
  } else if (e.key === 'Escape' && B.sel.length) {
    B.sel = [];
    drawWorld();
  }
}

const cardEl = (k) => document.querySelector(`.bcard[data-key="${CSS.escape(k)}"]`);
const groupEl = (id) => document.querySelector(`.bgroup[data-gid="${CSS.escape(id)}"]`);

function toggleSel(k) {
  const i = B.sel.indexOf(k);
  if (i >= 0) B.sel.splice(i, 1);
  else B.sel.push(k);
  const el = cardEl(k);
  if (el) el.classList.toggle('sel', i < 0);
  drawSelBar();
}

// ── 되돌리기 · 저장 ─────────────────────────────────

function pushUndo() {
  B.undo.push(JSON.stringify({ cards: B.board.cards, groups: B.board.groups, pairs: B.board.pairs }));
  if (B.undo.length > UNDO_MAX) B.undo.shift();
  const ub = $('#b-undo');
  if (ub) ub.disabled = false;
}

function doUndo() {
  const s = B.undo.pop();
  if (!s) return;
  const o = JSON.parse(s);
  B.board.cards = o.cards;
  B.board.groups = o.groups;
  B.board.pairs = o.pairs;
  B.sel = [];
  if (B.view === 'board') drawWorld();
  else {
    drawCandidates();
    drawPairs();
  }
  drawSummary();
  scheduleSave();
}

function scheduleSave() {
  B.dirty = true;
  drawSaveState();
  clearTimeout(B.saveTimer);
  B.saveTimer = setTimeout(saveNow, SAVE_MS);
}

async function saveNow() {
  const me = B;
  if (!me) return;
  clearTimeout(me.saveTimer);
  if (me.saving) {
    me.saveTimer = setTimeout(saveNow, 600);
    return;
  }
  me.saving = true;
  me.dirty = false;
  me.board.seq = (me.board.seq || 0) + 1;
  me.board.savedAt = Date.now();
  drawSaveState();
  try {
    await me.cli.boardPut(me.code, me.board);
    me.saveErr = false;
  } catch (e) {
    me.dirty = true;
    me.saveErr = true;
    if (B === me) me.saveTimer = setTimeout(saveNow, 5000);
  } finally {
    me.saving = false;
    if (B === me) drawSaveState();
  }
}

function drawSaveState() {
  const el = $('#b-save');
  if (!el || !B) return;
  if (B.saveErr) {
    el.className = 'save-state warn';
    el.textContent = '저장하지 못했어요 · 다시 해 볼게요';
  } else if (B.dirty || B.saving) {
    el.className = 'save-state';
    el.textContent = '저장하는 중…';
  } else {
    el.className = 'save-state';
    el.innerHTML = `${ICON.check.replace('#fff', 'currentColor')}저장됨`;
  }
}

// ── 질문 새로 받기 (활동 종료 직후 마지막으로 보낸 질문 · 다시 열었을 때) ──

async function pollItems() {
  const me = B;
  if (!me) return;
  try {
    const map = await me.cli.items(me.code);
    if (B !== me) return;
    const r = setItems(map);
    ensureCards();
    if (r.added.length || r.changed) {
      if (r.added.length) {
        placeNew();
        toast(`새 질문 ${r.added.length}개가 들어왔어요.`);
        scheduleSave();
      }
      drawFilter();
      if (B.view === 'board') drawWorld();
      else drawCandidates();
    }
  } catch (e) {}
  if (B === me) {
    const fast = Date.now() - me.since < FAST_ITEMS_MS;
    me.itemsTimer = setTimeout(pollItems, me.cli.pollMs(document.hidden ? 'hidden' : fast ? 'items' : 'itemsSlow'));
  }
}

// ── 고른 카드로 하기 ────────────────────────────────

// 고른 카드를 새 묶음 상자에 담아, 보드의 빈 곳(오른쪽 끝)에 놓고 그쪽으로 화면을 옮긴다
function groupSelected() {
  const keys = B.sel.filter(isVisible);
  if (!keys.length) return;
  pushUndo();
  const box = contentBox();
  const id = uid('g');
  const x = box ? box.x + box.w + 60 : 0;
  const y = box ? box.y : 0;
  const g = packInto(keys, x, y, '새 묶음', '#9cc877', id);
  B.sel = [];
  drawWorld();
  showArea(g.x, g.y, g.w, g.h);
  scheduleSave();
  editGroup(id, true);
}

// 보드의 한 곳이 화면 안에 들어오게 옮긴다 (너무 작아지지 않게)
function showArea(x, y, w, h) {
  const cv = $('#bcanvas');
  if (!cv) return;
  const cw = cv.clientWidth;
  const ch = cv.clientHeight;
  const sx = (x * B.z + B.tx);
  const sy = (y * B.z + B.ty);
  const inside = sx >= 0 && sy >= 50 && sx + w * B.z <= cw && sy + h * B.z <= ch - 60;
  if (inside) return;
  const z = Math.max(0.45, Math.min(B.z, (cw - 80) / w, (ch - 140) / h));
  B.z = z;
  B.tx = Math.min(40, cw - 40 - (x + w) * z);
  B.ty = Math.max(70, (ch - h * z) / 2) - y * z;
  applyView();
}

function newEmptyGroup() {
  pushUndo();
  const cv = $('#bcanvas');
  const cx = (cv.clientWidth / 2 - B.tx) / B.z;
  const cy = (cv.clientHeight / 2 - B.ty) / B.z;
  const id = uid('g');
  B.board.groups[id] = { x: Math.round(cx - 200), y: Math.round(cy - 130), w: 400, h: 260, title: '새 묶음', color: '#9cc877' };
  drawWorld();
  scheduleSave();
  editGroup(id, true);
}

function mergeSelected() {
  const keys = B.sel.filter(isVisible);
  if (keys.length < 2) return;
  pushUndo();
  const [main, ...rest] = keys;
  rest.forEach((k) => {
    childrenOf(k).forEach((x) => (card(x).into = main));
    card(k).into = main;
  });
  if (rest.some((k) => card(k).star)) card(main).star = 1;
  B.sel = [];
  drawWorld();
  scheduleSave();
  toast(`${keys.length}장을 한 장으로 합쳤어요. 카드의 ✎에서 다시 뗄 수 있어요.`, 'good');
}

function starSelected() {
  const keys = B.sel.filter(isVisible);
  if (!keys.length) return;
  pushUndo();
  const all = keys.every((k) => card(k).star);
  keys.forEach((k) => {
    if (all) delete card(k).star;
    else card(k).star = 1;
  });
  drawWorld();
  scheduleSave();
}

function lensSelected(id) {
  const keys = B.sel.filter(isVisible);
  if (!keys.length) return;
  pushUndo();
  keys.forEach((k) => (card(k).lens = id));
  drawWorld();
  scheduleSave();
}

function delSelected() {
  const keys = B.sel.filter(isVisible);
  if (!keys.length) return;
  pushUndo();
  keys.forEach((k) => (card(k).del = 1));
  B.sel = [];
  drawWorld();
  scheduleSave();
  toast(`${keys.length}장을 지웠어요. [지운 질문]에서 되살릴 수 있어요.`);
}

// ── 카드 · 묶음 고치기 창 ───────────────────────────

function lensChips(cur, name) {
  return `<div class="lens-pick" role="radiogroup" aria-label="렌즈">${lensOrder()
    .map((id) => {
      const L = lensInfo(id);
      return `<label class="lp" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}"><input type="radio" name="${name}" value="${esc(id)}" ${id === cur ? 'checked' : ''}><span>${esc(L.name)}</span></label>`;
    })
    .join('')}</div>`;
}

function editCard(k) {
  const q = item(k);
  if (!q) return;
  const c = card(k);
  const kids = childrenOf(k);
  const md = openModal(`<div class="card-editor">
    <h2>질문 카드</h2>
    <div class="field"><label for="ce-text">질문</label><textarea class="input" id="ce-text" rows="3" maxlength="140">${esc(textOf(k))}</textarea>
      <div class="ce-orig">${c.text ? `학생이 쓴 질문: <b>${esc(q.text)}</b> <button type="button" class="btn btn-ghost btn-sm" data-ce="orig">원래대로</button>` : ''}</div></div>
    <div class="field"><div class="field-label" style="font-size:17px">렌즈</div>${lensChips(lensOf(k), 'ce-lens')}
      ${q.lens && lensOf(k) !== q.lens ? `<div class="ce-orig">학생이 고른 렌즈: ${esc(lensInfo(q.lens).name)}</div>` : ''}</div>
    <div class="ce-info">${esc(q.name)}${q.mat ? ` · 자료: ${esc(matName(q.mat))}` : ''} · ${esc(String(q.time || '').slice(5, 16))}</div>
    ${
      kids.length
        ? `<div class="field"><div class="field-label" style="font-size:17px">합친 질문 ${kids.length}개</div><ul class="ce-kids">${kids
            .map((x) => `<li><span>${esc(textOf(x))} <em>${esc(item(x).name)}</em></span><button type="button" class="btn btn-ghost btn-sm" data-ce="split" data-k="${esc(x)}">떼어내기</button></li>`)
            .join('')}</ul></div>`
        : ''
    }
    <div class="actions">
      <button type="button" class="btn btn-ghost" data-ce="del">${ICON.trash}지우기</button>
      <label class="check" style="margin-right:auto"><input type="checkbox" id="ce-star" ${c.star ? 'checked' : ''}> 별표</label>
      <button type="button" class="btn btn-cream" data-ce="close">취소</button>
      <button type="button" class="btn btn-primary" data-ce="save">고치기 완료</button>
    </div></div>`);
  const el = md.el;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ce]');
    if (!b) return;
    const act = b.dataset.ce;
    if (act === 'close') return md.close();
    if (act === 'orig') {
      $('#ce-text', el).value = q.text;
      b.parentElement.innerHTML = '';
      return;
    }
    pushUndo();
    if (act === 'split') {
      const x = b.dataset.k;
      delete card(x).into;
      card(x).x = c.x + 26;
      card(x).y = c.y + (B.h[k] || 90) + 18;
      b.closest('li').remove();
    } else if (act === 'del') {
      c.del = 1;
      B.sel = B.sel.filter((x) => x !== k);
      md.close();
    } else if (act === 'save') {
      const t = $('#ce-text', el).value.replace(/\s+/g, ' ').trim();
      if (t && t !== q.text) c.text = t.slice(0, 140);
      else delete c.text;
      const pick = el.querySelector('input[name=ce-lens]:checked');
      const lens = pick ? pick.value : '';
      if (lens === (q.lens || '')) delete c.lens;
      else c.lens = lens;
      if ($('#ce-star', el).checked) c.star = 1;
      else delete c.star;
      md.close();
    }
    drawWorld();
    scheduleSave();
  });
}

const GROUP_COLORS = ['#9cc877', '#8fb8e8', '#ee9a73', '#f2cc5c', '#b7a3e0', '#7fcfc2', '#e99bb5', '#c9a27a', '#d9cdb8'];

function editGroup(gid, isNew = false) {
  const g = B.board.groups[gid];
  if (!g) return;
  const md = openModal(`<div class="card-editor">
    <h2>${isNew ? '묶음 상자 이름 붙이기' : '묶음 상자'}</h2>
    <div class="field"><label for="ge-title">이름</label><input class="input" id="ge-title" maxlength="24" value="${esc(g.title || '')}" autocomplete="off" placeholder="예: 쓰레기가 생기는 까닭"></div>
    <div class="field"><div class="field-label" style="font-size:17px">색</div><div class="color-pick">${GROUP_COLORS.map(
      (c) => `<label><input type="radio" name="ge-color" value="${c}" ${c === g.color ? 'checked' : ''}><span style="background:${c}"></span></label>`
    ).join('')}</div></div>
    <p class="fl-note">상자 안에 있는 카드는 상자와 함께 움직여요. 오른쪽 아래 모서리를 끌면 크기가 바뀌어요.</p>
    <div class="actions">
      <button type="button" class="btn btn-ghost" data-ge="del" style="margin-right:auto">${ICON.trash}상자 지우기 (카드는 남아요)</button>
      <button type="button" class="btn btn-cream" data-ge="close">${isNew ? '이대로 두기' : '취소'}</button>
      <button type="button" class="btn btn-primary" data-ge="save">완료</button>
    </div></div>`);
  const el = md.el;
  const inp = $('#ge-title', el);
  if (isNew) setTimeout(() => inp.select(), 40);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) el.querySelector('[data-ge=save]').click();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ge]');
    if (!b) return;
    if (b.dataset.ge === 'close') return md.close();
    if (!isNew) pushUndo();
    if (b.dataset.ge === 'del') delete B.board.groups[gid];
    else {
      g.title = inp.value.trim() || '묶음';
      const c = el.querySelector('input[name=ge-color]:checked');
      if (c) g.color = c.value;
    }
    md.close();
    drawWorld();
    scheduleSave();
  });
}

// ── 지운 질문 ───────────────────────────────────────

function drawTrash() {
  const box = $('#trash');
  if (!box) return;
  const del = Object.keys(B.items).filter((k) => card(k).del);
  box.innerHTML = `<div class="tr-head"><b>지운 질문 ${del.length}개</b><span class="spacer"></span><button type="button" class="btn btn-ghost btn-icon" data-act="b-trash" aria-label="닫기">${ICON.x}</button></div>
    <div class="tr-list">${
      del.length
        ? del.map((k) => `<div class="tr-item"><span>${esc(textOf(k))}</span><button type="button" class="btn btn-cream btn-sm" data-act="b-restore" data-key="${esc(k)}">되살리기</button></div>`).join('')
        : '<div class="empty-state" style="padding:16px">지운 질문이 없어요.</div>'
    }</div>`;
}

// ════════════════════════════════════════════════
// 프로젝트 탐구 질문 (렌즈 - 질문 쌍)
// ════════════════════════════════════════════════

function candidates() {
  const f = ($('#pc-filter') && $('#pc-filter').value) || 'all';
  const s = (($('#pc-search') && $('#pc-search').value) || '').trim();
  const order = lensOrder();
  return visibleKeys()
    .filter((k) => passes(k, f) && (!s || textOf(k).includes(s)))
    .sort((a, b) => (card(b).star ? 1 : 0) - (card(a).star ? 1 : 0) || order.indexOf(lensOf(a)) - order.indexOf(lensOf(b)) || (item(a).at || 0) - (item(b).at || 0));
}

function drawCandidates() {
  const box = $('#pc-list');
  if (!box) return;
  const list = candidates();
  $('#bv-pairs').classList.toggle('is-selecting', !!B.pairSel);
  box.innerHTML = list.length
    ? list
        .map((k) => {
          const L = lensInfo(lensOf(k));
          const kids = childrenOf(k).filter((x) => !card(x).del).length;
          return `<div class="qcard pc-q ${B.pairSel === k ? 'selected' : ''}" data-id="${esc(k)}" tabindex="0" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}">
            <span class="pc-lens">${esc(L.name)}</span>${card(k).star ? `<span class="bc-star">${ICON.star}</span>` : ''}${kids ? `<span class="bc-merged">+${kids}</span>` : ''}
            <div>${esc(textOf(k))}</div></div>`;
        })
        .join('')
    : '<div class="empty-state" style="padding:18px">맞는 질문이 없어요.</div>';
}

function lensSelect(row) {
  return `<select class="pm-lens" data-pair-lens="${esc(row.id)}" aria-label="개념적 렌즈"><option value="">렌즈 고르기</option>${B.lenses
    .map((l) => `<option value="${esc(l.id)}" ${l.id === row.lens ? 'selected' : ''}>${esc(l.name)}</option>`)
    .join('')}</select>`;
}

function drawPairs() {
  const box = $('#pm-rows');
  if (!box) return;
  const rows = B.board.pairs;
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state" style="padding:22px">칸이 없어요. 아래 [칸 더하기]를 눌러요.</div>`;
    return;
  }
  box.innerHTML = rows
    .map((r, i) => {
      const L = r.lens ? lensInfo(r.lens) : NO_LENS;
      const src = r.from && item(r.from);
      return `<div class="pm-row ${r.lens ? '' : 'nolens'}" data-zone="pair:${esc(r.id)}" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}">
        <div class="pm-num">${i + 1}</div>
        <div class="pm-lens-box">${lensSelect(r)}${r.lens && L.desc ? `<div class="pm-desc">${esc(L.desc)}</div>` : ''}</div>
        <div class="pm-arrow" aria-hidden="true">→</div>
        <div class="pm-q"><textarea class="input" data-pair-text="${esc(r.id)}" rows="2" maxlength="140" placeholder="탐구 질문을 쓰거나, 왼쪽 질문을 끌어다 놓아요" aria-label="${i + 1}번 탐구 질문">${esc(r.text)}</textarea>
          ${src ? `<div class="pm-from">가져온 질문: ${esc(item(r.from).text)} <em>${esc(src.name)}</em></div>` : ''}</div>
        <div class="pm-tools">
          <button type="button" class="btn btn-ghost btn-icon" data-act="p-up" data-id="${esc(r.id)}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button type="button" class="btn btn-ghost btn-icon" data-act="p-down" data-id="${esc(r.id)}" aria-label="아래로" ${i === rows.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button type="button" class="btn btn-ghost btn-icon" data-act="p-del" data-id="${esc(r.id)}" aria-label="칸 지우기">${ICON.trash}</button>
        </div>
      </div>`;
    })
    .join('');
}

function putPair(key, zone) {
  if (!String(zone).startsWith('pair:') || !item(key)) return;
  const row = B.board.pairs.find((r) => r.id === zone.slice(5));
  if (!row) return;
  pushUndo();
  row.text = textOf(key);
  row.from = key;
  if (!row.lens) row.lens = lensOf(key);
  B.pairSel = null;
  drawCandidates();
  drawPairs();
  scheduleSave();
}

let pairUndoArmed = null;

function onInput(e) {
  const t = e.target;
  if (t.dataset && t.dataset.pairText !== undefined) {
    const row = B.board.pairs.find((r) => r.id === t.dataset.pairText);
    if (!row) return;
    if (pairUndoArmed !== row.id) {
      pushUndo();
      pairUndoArmed = row.id;
    }
    row.text = t.value;
    scheduleSave();
  } else if (t.id === 'pc-search') drawCandidates();
}

function onChange(e) {
  const t = e.target;
  if (t.id === 'bt-filter') {
    B.filter = t.value;
    drawWorld();
  } else if (t.id === 'pc-filter') drawCandidates();
  else if (t.id === 'sel-lens') {
    if (t.value !== '__') lensSelected(t.value);
  } else if (t.dataset && t.dataset.pairLens !== undefined) {
    const row = B.board.pairs.find((r) => r.id === t.dataset.pairLens);
    if (!row) return;
    pushUndo();
    row.lens = t.value;
    drawPairs();
    scheduleSave();
  }
}

function onClick(e) {
  if (!B) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (!act.startsWith('b-') && !act.startsWith('p-')) return;
  switch (act) {
    case 'b-view':
      showView(el.dataset.v);
      break;
    case 'b-home':
      if (B.dirty) saveNow();
      B.onHome();
      break;
    case 'b-reopen':
      if (B.dirty) saveNow();
      B.onReopen();
      break;
    case 'b-layout':
      confirmBox({ title: '렌즈별로 다시 펼칠까요?', body: '카드를 렌즈마다 묶음 상자에 나눠 다시 놓아요. 지금 만든 묶음 상자는 사라져요. (되돌리기로 돌아올 수 있어요)', ok: '펼치기' }).then((ok) => {
        if (!ok) return;
        pushUndo();
        layoutByLens();
        fitView();
        scheduleSave();
      });
      break;
    case 'b-group-new':
      if (B.sel.length) groupSelected();
      else newEmptyGroup();
      break;
    case 'b-names':
      B.showNames = !B.showNames;
      drawWorld();
      break;
    case 'b-trash':
      B.trashOpen = !B.trashOpen;
      $('#trash').classList.toggle('hidden', !B.trashOpen);
      if (B.trashOpen) drawTrash();
      break;
    case 'b-restore': {
      pushUndo();
      delete card(el.dataset.key).del;
      drawWorld();
      scheduleSave();
      break;
    }
    case 'b-undo':
      doUndo();
      break;
    case 'b-zoom': {
      const r = $('#bcanvas').getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, el.dataset.d === '1' ? 1.2 : 1 / 1.2);
      break;
    }
    case 'b-fit':
      fitView();
      break;
    case 'b-card':
      editCard(el.dataset.key);
      break;
    case 'b-group':
      editGroup(el.dataset.gid);
      break;
    case 'b-gzoom':
      zoomToGroup(el.dataset.gid);
      break;
    case 'b-sel-group':
      groupSelected();
      break;
    case 'b-sel-merge':
      mergeSelected();
      break;
    case 'b-sel-star':
      starSelected();
      break;
    case 'b-sel-del':
      delSelected();
      break;
    case 'b-sel-clear':
      B.sel = [];
      drawWorld();
      break;
    case 'b-export':
      exportMenu();
      break;
    case 'p-add':
      pushUndo();
      B.board.pairs.push(newPair());
      drawPairs();
      scheduleSave();
      break;
    case 'p-del': {
      const row = B.board.pairs.find((r) => r.id === el.dataset.id);
      const go = () => {
        pushUndo();
        B.board.pairs = B.board.pairs.filter((r) => r.id !== el.dataset.id);
        drawPairs();
        scheduleSave();
      };
      if (row && (row.text || row.lens)) confirmBox({ title: '이 칸을 지울까요?', body: esc(row.text || ''), ok: '지우기', danger: true }).then((ok) => ok && go());
      else go();
      break;
    }
    case 'p-up':
    case 'p-down': {
      const i = B.board.pairs.findIndex((r) => r.id === el.dataset.id);
      const j = i + (act === 'p-up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= B.board.pairs.length) return;
      pushUndo();
      const [r] = B.board.pairs.splice(i, 1);
      B.board.pairs.splice(j, 0, r);
      drawPairs();
      scheduleSave();
      break;
    }
    case 'p-png':
      pairsPng();
      break;
    case 'p-print':
      pairsPrint();
      break;
    case 'p-csv':
      pairsCsv();
      break;
    default:
  }
}

// ════════════════════════════════════════════════
// 내려받기: 그림(PNG) · CSV · 인쇄
// ════════════════════════════════════════════════

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function fileBase() {
  const t = String((B.getGame() && B.getGame().title) || '탐구질문').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  return `${t}_${B.code}`;
}

function wrap(ctx, text, maxW) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    const tryLine = line + ch;
    if (ctx.measureText(tryLine).width > maxW && line) {
      // 낱말 중간에서 끊지 않도록 마지막 띄어쓰기에서 자른다
      const sp = line.lastIndexOf(' ');
      if (sp > 0 && ch !== ' ') {
        out.push(line.slice(0, sp));
        line = line.slice(sp + 1) + ch;
      } else {
        out.push(line);
        line = ch === ' ' ? '' : ch;
      }
    } else line = tryLine;
  }
  if (line) out.push(line);
  return out;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    if (!blob) return toast('그림을 만들지 못했어요. 보드가 너무 크면 몇 묶음씩 나눠 저장해 주세요.', 'warn');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load(`700 20px Dunggeunmiso`), document.fonts.load(`400 16px Dunggeunmiso`)]);
  } catch (e) {}
}

async function boardPng() {
  if (B.view !== 'board') showView('board');
  const box = contentBox();
  if (!box) return toast('그릴 카드가 없어요.', 'warn');
  await fontsReady();
  const M = 50;
  const TOP = 90;
  const W = box.w + M * 2;
  const H = box.h + M * 2 + TOP;
  const scale = Math.min(2, 7000 / W, 7000 / H);
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale);
  cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3b3125';
  ctx.font = `700 32px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`우리 반 탐구 질문 보드 · ${(B.getGame() && B.getGame().title) || ''}`, M, 34);
  const ox = M - box.x;
  const oy = M + TOP - box.y;
  Object.values(B.board.groups).forEach((g) => {
    rr(ctx, g.x + ox, g.y + oy, g.w, g.h, 22);
    ctx.fillStyle = (g.color || '#d9cdb8') + '2e';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = g.color || '#d9cdb8';
    ctx.stroke();
    ctx.fillStyle = '#3b3125';
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(g.title || '묶음', g.x + ox + 16, g.y + oy + 16);
  });
  visibleKeys().forEach((k) => {
    const c = card(k);
    const L = lensInfo(lensOf(k));
    const x = c.x + ox;
    const y = c.y + oy;
    const h = B.h[k] || 90;
    rr(ctx, x, y, CARD_W, h, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = L.color.main;
    ctx.stroke();
    ctx.font = `700 13px ${FONT}`;
    const lw = ctx.measureText(L.name).width + 16;
    rr(ctx, x + 10, y + 10, lw, 22, 11);
    ctx.fillStyle = L.color.soft;
    ctx.fill();
    ctx.fillStyle = L.color.ink;
    ctx.fillText(L.name, x + 18, y + 15);
    if (c.star) {
      ctx.fillStyle = '#c99a1b';
      ctx.fillText('★', x + lw + 16, y + 14);
    }
    ctx.fillStyle = '#3b3125';
    ctx.font = `400 16px ${FONT}`;
    wrap(ctx, textOf(k), CARD_W - 24).forEach((ln, i) => ctx.fillText(ln, x + 12, y + 42 + i * 22));
  });
  downloadCanvas(cv, `탐구질문보드_${fileBase()}_${stamp()}.png`);
}

function exportMenu() {
  const md = openModal(`<div class="card-editor"><h2>${ICON.download} 내려받기</h2>
    <p class="fl-note" style="margin-top:0">서버에서는 게임을 만든 뒤 하루가 지나면 지워져요. 수업이 끝나면 내려받아 두세요.</p>
    <div class="export-list">
      <button type="button" class="export-item" data-ex="png">${ICON.image}<span><b>보드 그림 (PNG)</b><small>지금 보드에 놓인 모습 그대로</small></span></button>
      <button type="button" class="export-item" data-ex="csv">${ICON.sheet}<span><b>모든 질문 (CSV)</b><small>학생 질문 · 고친 질문 · 렌즈 · 묶음 · 별표 · 지움</small></span></button>
      <button type="button" class="export-item" data-ex="pairs">${ICON.lens}<span><b>프로젝트 탐구 질문</b><small>「프로젝트 탐구 질문」 화면에서 그림 · 인쇄 · CSV로 저장해요</small></span></button>
    </div>
    <div class="actions"><button type="button" class="btn btn-cream" data-ex="close">닫기</button></div></div>`);
  md.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (!b) return;
    md.close();
    if (b.dataset.ex === 'png') boardPng();
    else if (b.dataset.ex === 'csv') questionsCsv();
    else if (b.dataset.ex === 'pairs') showView('pairs');
  });
}

function questionsCsv() {
  const head = ['번호', '별명', '학생 질문', '보드에서 고친 질문', '학생이 고른 렌즈', '보드 렌즈', '묶음', '합친 곳', '별표', '지움', '자료', '쓴 시각'];
  const rows = [head];
  const keys = Object.keys(B.items).sort((a, b) => (item(a).at || 0) - (item(b).at || 0));
  const no = {};
  keys.forEach((k, i) => (no[k] = i + 1));
  keys.forEach((k) => {
    const q = item(k);
    const c = card(k);
    let host = k;
    while (card(host).into && item(card(host).into) && host !== card(host).into) host = card(host).into;
    const g = groupOfKey(host);
    rows.push([
      no[k],
      q.name,
      q.text,
      c.text || '',
      q.lens ? lensInfo(q.lens).name : '',
      lensInfo(lensOf(k)).name === NO_LENS.name ? '' : lensInfo(lensOf(k)).name,
      g ? g[1].title || '묶음' : '',
      c.into && item(c.into) ? `${no[c.into]}번 질문` : '',
      c.star ? '★' : '',
      c.del ? '지움' : '',
      q.mat ? matName(q.mat) : '',
      q.time || '',
    ]);
  });
  downloadText(`탐구질문_모든질문_${fileBase()}_${stamp()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
}

function filledPairs() {
  return B.board.pairs.filter((r) => String(r.text || '').trim() || r.lens);
}

function pairsCsv() {
  const rows = [['순서', '개념적 렌즈', '탐구 질문', '가져온 학생 질문', '프로젝트']];
  const title = (B.getGame() && B.getGame().title) || '';
  filledPairs().forEach((r, i) => rows.push([i + 1, r.lens ? lensInfo(r.lens).name : '', String(r.text || '').trim(), r.from && item(r.from) ? item(r.from).text : '', title]));
  if (rows.length === 1) return toast('아직 적은 탐구 질문이 없어요.', 'warn');
  downloadText(`프로젝트탐구질문_${fileBase()}_${stamp()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
}

async function pairsPng() {
  const rows = filledPairs();
  if (!rows.length) return toast('아직 적은 탐구 질문이 없어요.', 'warn');
  await fontsReady();
  const W = 1500;
  const ctx0 = document.createElement('canvas').getContext('2d');
  ctx0.font = `700 30px ${FONT}`;
  const lines = rows.map((r) => wrap(ctx0, String(r.text || '').trim() || '(질문을 아직 쓰지 않았어요)', W - 140 - 330 - 60));
  const rowH = lines.map((l) => Math.max(110, 50 + l.length * 42));
  const H = 230 + rowH.reduce((a, b) => a + b + 22, 0) + 40;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5b8751';
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText('우리 반 프로젝트 탐구 질문', 70, 60);
  ctx.fillStyle = '#3b3125';
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText((B.getGame() && B.getGame().title) || '', 70, 100);
  let y = 200;
  rows.forEach((r, i) => {
    const L = r.lens ? lensInfo(r.lens) : NO_LENS;
    const h = rowH[i];
    rr(ctx, 70, y, W - 140, h, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = L.color.main;
    ctx.stroke();
    rr(ctx, 70, y, 300, h, 26);
    ctx.fillStyle = L.color.soft;
    ctx.fill();
    ctx.fillStyle = L.color.ink;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(`${i + 1}`, 96, y + h / 2 - 12);
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(L.name === NO_LENS.name ? '렌즈' : L.name, 136, y + h / 2 - 18);
    ctx.fillStyle = '#7d6c55';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText('→', 388, y + h / 2 - 16);
    ctx.fillStyle = '#3b3125';
    ctx.font = `700 30px ${FONT}`;
    const top = y + (h - lines[i].length * 42) / 2 + 4;
    lines[i].forEach((ln, j) => ctx.fillText(ln, 440, top + j * 42));
    y += h + 22;
  });
  downloadCanvas(cv, `프로젝트탐구질문_${fileBase()}_${stamp()}.png`);
}

function pairsPrint() {
  const rows = filledPairs();
  if (!rows.length) return toast('아직 적은 탐구 질문이 없어요.', 'warn');
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.innerHTML = `<div class="ps-eyebrow">우리 반 프로젝트 탐구 질문</div><h1>${esc((B.getGame() && B.getGame().title) || '')}</h1>
    ${rows
      .map((r, i) => {
        const L = r.lens ? lensInfo(r.lens) : NO_LENS;
        return `<div class="ps-row" style="--lc:${L.color.main};--ls:${L.color.soft};--li:${L.color.ink}"><div class="ps-lens"><span>${i + 1}</span>${esc(L.name === NO_LENS.name ? '렌즈' : L.name)}</div><div class="ps-q">${esc(String(r.text || '').trim())}</div></div>`;
      })
      .join('')}`;
  document.body.appendChild(sheet);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    sheet.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => {
    window.print();
    setTimeout(done, 1500);
  }, 60);
}

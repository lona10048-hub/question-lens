// 선생님: 활동 준비 화면 (프로젝트 · 자료 · 렌즈 · 연습 그림)
//  - 만들던 자료(초안)는 이 브라우저(IndexedDB)에 저장해 두어, 새로고침하거나 다음 수업에도 이어서 쓸 수 있다.
//  - 선생님이 추가한 렌즈 · 숨긴 렌즈 · 연습 그림은 이 컴퓨터에 기억해 두고 다음 게임에도 쓴다.

import { $, esc, toast, openModal, confirmBox, compressImage, ICON } from './ui.js';
import { DEFAULT_LENSES, CUSTOM_COLORS, BUILTIN_PICTURES, LIMITS, MAT_KINDS, uid } from './lenses.js';
import { matIcon, matKindName, matTitle, matSummary, matThumbHtml, matBodyHtml, matImages, videoEmbed, cleanUrl, parseTable, tableToText, pdfToImages, hydrate } from './materials.js';
import { idbGet, idbSet, idbDel } from './idb.js';

const PREFS_KEY = 'ql-teacher-prefs';
const DRAFT_KEY = 'draft';

// F: 지금 만들고 있는 것
export const F = {
  title: '',
  intro: '',
  materials: [],
  prefs: loadPrefs(),
  loaded: false,
  onChange: () => {},
};

function loadPrefs() {
  const base = { hidden: [], custom: [], picOff: [], pictures: [] };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (Array.isArray(p.hidden)) base.hidden = p.hidden.filter((x) => typeof x === 'string');
    if (Array.isArray(p.custom)) base.custom = p.custom.filter((l) => l && l.id && l.name).slice(0, LIMITS.customLenses);
    if (Array.isArray(p.picOff)) base.picOff = p.picOff;
    if (Array.isArray(p.pictures)) base.pictures = p.pictures.filter((x) => x && x.id).slice(0, LIMITS.customPictures);
  } catch (e) {}
  return base;
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(F.prefs));
  } catch (e) {}
}

let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    idbSet(DRAFT_KEY, { title: F.title, intro: F.intro, materials: F.materials, at: Date.now() });
  }, 400);
}

export async function loadDraft() {
  if (F.loaded) return;
  const d = await idbGet(DRAFT_KEY, { remember: false });
  if (d) {
    F.title = d.title || '';
    F.intro = d.intro || '';
    F.materials = Array.isArray(d.materials) ? d.materials : [];
  }
  F.loaded = true;
}

const draftImg = (name) => idbGet('dimg:' + name, { remember: false }).then((v) => (v ? v.data : null));
const picImg = (id) => idbGet('pic:' + id, { remember: false }).then((v) => (v ? v.data : null));

// 준비 화면에서 그림 보여 주기
export function draftSrc(name) {
  if (String(name).startsWith('p-')) return picImg(name);
  return draftImg(name);
}

function changed() {
  saveDraft();
  F.onChange();
}

// ── 렌즈 · 연습 그림 (이번 수업에 쓸 것) ───────────────

export function allLenses() {
  return DEFAULT_LENSES.concat(F.prefs.custom);
}

export function visibleLenses() {
  const hide = new Set(F.prefs.hidden);
  return allLenses().filter((l) => !hide.has(l.id));
}

export function visiblePictures() {
  const off = new Set(F.prefs.picOff);
  return BUILTIN_PICTURES.filter((p) => !off.has(p.id))
    .map((p) => ({ id: p.id, title: p.title, hint: p.hint, builtin: true }))
    .concat(F.prefs.pictures.filter((p) => !off.has(p.id)).map((p) => ({ id: p.id, title: p.title, hint: p.hint, img: p.id })));
}

export function imageCount() {
  return F.materials.reduce((n, m) => n + matImages(m).length, 0) + visiblePictures().filter((p) => p.img).length;
}

// 게임 만들기에 필요한 것: 설정(cfg)과 올릴 그림 목록
export function collectForCreate() {
  const lenses = visibleLenses().map((l) => ({ id: l.id, name: l.name, desc: l.desc, frames: l.frames, example: l.example || '', color: l.color, custom: !!l.custom }));
  const pictures = visiblePictures();
  const materials = F.materials.map((m) => ({ ...m }));
  const images = [];
  materials.forEach((m) => matImages(m).forEach((name) => images.push({ name, get: () => draftImg(name) })));
  pictures.filter((p) => p.img).forEach((p) => images.push({ name: p.img, get: () => picImg(p.id) }));
  return {
    cfg: { v: 1, title: F.title.trim(), intro: F.intro.trim(), lenses, pictures, materials },
    images,
  };
}

export function problems() {
  const out = [];
  if (!F.title.trim()) out.push('프로젝트 이름을 써 주세요.');
  if (!visibleLenses().length) out.push('렌즈를 하나 이상 보이게 해 주세요.');
  if (!visiblePictures().length) out.push('연습 그림을 하나 이상 골라 주세요.');
  if (imageCount() > LIMITS.images) out.push(`그림(이미지 · PDF 쪽 · 연습 그림)은 ${LIMITS.images}장까지 올릴 수 있어요.`);
  return out;
}

// ════════════════════════════════════════════════
// 화면
// ════════════════════════════════════════════════

export function setupHtml() {
  return `
    <div class="setup-grid" style="margin-top:28px">
      <div class="full field">
        <div class="field-label"><span class="form-num">1</span>프로젝트</div>
        <div class="proj-fields">
          <label class="sr-only" for="p-title">프로젝트 이름</label>
          <input class="input" id="p-title" maxlength="${LIMITS.title}" autocomplete="off" placeholder="프로젝트 이름 (예: 우리 동네 쓰레기 줄이기)" value="${esc(F.title)}">
          <label class="sr-only" for="p-intro">한 줄 소개</label>
          <input class="input" id="p-intro" maxlength="${LIMITS.intro}" autocomplete="off" placeholder="한 줄 소개 · 선택 (예: 우리 반에서 나오는 쓰레기를 살펴봐요)" value="${esc(F.intro)}">
        </div>
      </div>
      <div class="full field">
        <div class="field-label"><span class="form-num">2</span>자료 올리기 <span class="fl-note">학생들이 보고 질문을 만들 자료예요</span></div>
        <div class="mat-add" role="group" aria-label="자료 더하기">
          ${['text', 'image', 'pdf', 'table', 'video', 'link']
            .map((k) => `<button type="button" class="btn btn-cream" data-act="mat-add" data-kind="${k}">${matIcon(k)}${k === 'video' ? '영상 링크' : MAT_KINDS[k].name}</button>`)
            .join('')}
        </div>
        <div id="mat-list" class="mat-list"></div>
      </div>
      <div class="full field">
        <div class="field-label"><span class="form-num">3</span>렌즈 <span class="fl-note">학생 화면에 보일 렌즈를 골라요 · 렌즈를 추가할 수도 있어요</span></div>
        <div id="lens-list" class="lens-setup"></div>
      </div>
      <div class="full field">
        <div class="field-label"><span class="form-num">4</span>렌즈 연습 그림 <span class="fl-note">「렌즈를 통해 질문하기」에서 쓸 그림이에요</span></div>
        <div id="pic-list" class="pic-setup"></div>
      </div>
    </div>`;
}

export function bindSetup(root) {
  const t = $('#p-title', root);
  const i = $('#p-intro', root);
  t.addEventListener('input', () => {
    F.title = t.value;
    changed();
  });
  i.addEventListener('input', () => {
    F.intro = i.value;
    changed();
  });
  root.addEventListener('click', onClick);
  drawMaterials();
  drawLenses();
  drawPictures();
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'mat-add':
      addMaterial(el.dataset.kind);
      break;
    case 'mat-edit':
      editMaterial(id);
      break;
    case 'mat-del':
      delMaterial(id);
      break;
    case 'mat-up':
    case 'mat-down':
      moveMaterial(id, el.dataset.act === 'mat-up' ? -1 : 1);
      break;
    case 'mat-view':
      previewMaterial(id);
      break;
    case 'lens-toggle':
      toggleLens(id);
      break;
    case 'lens-add':
      lensEditor();
      break;
    case 'lens-edit':
      lensEditor(F.prefs.custom.find((l) => l.id === id));
      break;
    case 'lens-del':
      delLens(id);
      break;
    case 'pic-toggle':
      togglePic(id);
      break;
    case 'pic-add':
      pictureEditor();
      break;
    case 'pic-del':
      delPic(id);
      break;
    default:
  }
}

// ── 자료 목록 ───────────────────────────────────────

function drawMaterials() {
  const box = $('#mat-list');
  if (!box) return;
  if (!F.materials.length) {
    box.innerHTML = `<div class="mat-empty-list">${ICON.upload}<div><b>아직 자료가 없어요</b><br>위 버튼으로 글 · 이미지 · PDF · 표 · 영상 링크 · 링크를 더해 보세요. 자료가 없어도 활동은 할 수 있어요.</div></div>`;
    return;
  }
  const n = F.materials.length;
  box.innerHTML = F.materials
    .map(
      (m, idx) => `<div class="mat-item">
      <button type="button" class="mi-thumb" data-act="mat-view" data-id="${esc(m.id)}" aria-label="${esc(matTitle(m, idx))} 미리 보기">${matThumbHtml(m)}</button>
      <div class="mi-body">
        <div class="mi-title"><span class="chip cream">${matIcon(m.kind)}${matKindName(m.kind)}</span><b>${esc(matTitle(m, idx))}</b></div>
        <div class="mi-sum">${esc(matSummary(m))}</div>
      </div>
      <div class="mi-tools">
        <button type="button" class="btn btn-ghost btn-icon" data-act="mat-up" data-id="${esc(m.id)}" aria-label="위로" ${idx === 0 ? 'disabled' : ''}>${ICON.up}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="mat-down" data-id="${esc(m.id)}" aria-label="아래로" ${idx === n - 1 ? 'disabled' : ''}>${ICON.down}</button>
        <button type="button" class="btn btn-cream btn-sm" data-act="mat-edit" data-id="${esc(m.id)}">${ICON.edit}고치기</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="mat-del" data-id="${esc(m.id)}" aria-label="지우기">${ICON.trash}</button>
      </div>
    </div>`
    )
    .join('');
  hydrate(box, draftSrc);
}

function upsertMaterial(m) {
  const i = F.materials.findIndex((x) => x.id === m.id);
  if (i >= 0) F.materials[i] = m;
  else {
    if (F.materials.length >= LIMITS.materials) {
      toast(`자료는 ${LIMITS.materials}개까지 올릴 수 있어요.`, 'warn');
      return false;
    }
    F.materials.push(m);
  }
  drawMaterials();
  changed();
  return true;
}

async function delMaterial(id) {
  const m = F.materials.find((x) => x.id === id);
  if (!m) return;
  const ok = await confirmBox({ title: '이 자료를 뺄까요?', body: esc(matTitle(m)), ok: '빼기', danger: true });
  if (!ok) return;
  F.materials = F.materials.filter((x) => x.id !== id);
  matImages(m).forEach((name) => idbDel('dimg:' + name));
  drawMaterials();
  changed();
}

function moveMaterial(id, dir) {
  const i = F.materials.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= F.materials.length) return;
  const [m] = F.materials.splice(i, 1);
  F.materials.splice(j, 0, m);
  drawMaterials();
  changed();
}

function previewMaterial(id) {
  const m = F.materials.find((x) => x.id === id);
  if (!m) return;
  let page = 0;
  const md = openModal(`<div class="mat-modal"><h2>${esc(matTitle(m))}</h2><div class="mat-stage" id="pv-stage"></div>
    <div class="actions"><button type="button" class="btn btn-cream" data-close>닫기</button></div></div>`, { wide: true });
  const draw = () => {
    const st = $('#pv-stage', md.el);
    st.innerHTML = matBodyHtml(m, { page });
    hydrate(st, draftSrc);
  };
  draw();
  md.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) md.close();
    if (e.target.closest('[data-act=pdf-prev]')) {
      page = Math.max(0, page - 1);
      draw();
    }
    if (e.target.closest('[data-act=pdf-next]')) {
      page = Math.min((m.pages || []).length - 1, page + 1);
      draw();
    }
  });
}

function addMaterial(kind) {
  if (kind === 'image') return pickImages();
  if (kind === 'pdf') return pickPdf();
  editor(kind, null);
}

function editMaterial(id) {
  const m = F.materials.find((x) => x.id === id);
  if (m) editor(m.kind, m);
}

// ── 자료 고치기 창 ─────────────────────────────────

function editor(kind, m) {
  const isNew = !m;
  const cur = m ? { ...m } : { id: uid('m'), kind, title: '' };
  const titleField = `<div class="field"><label for="ed-title">제목 <span class="fl-note">선택</span></label><input class="input" id="ed-title" maxlength="${LIMITS.matTitle}" value="${esc(cur.title || '')}" autocomplete="off"></div>`;
  let body = '';
  if (kind === 'text')
    body = `${titleField}<div class="field"><label for="ed-text">글</label><textarea class="input" id="ed-text" rows="10" maxlength="${LIMITS.textChars}" placeholder="학생들이 읽을 글을 써요. (빈 줄로 문단을 나눠요)">${esc(cur.text || '')}</textarea><div class="count" id="ed-count"></div></div>`;
  else if (kind === 'image' || kind === 'pdf')
    body = `${titleField}${kind === 'image' ? `<div class="field"><label for="ed-cap">설명 <span class="fl-note">선택 · 그림 아래에 보여요</span></label><input class="input" id="ed-cap" maxlength="80" value="${esc(cur.caption || '')}" autocomplete="off"></div>` : ''}`;
  else if (kind === 'table')
    body = `${titleField}<div class="field"><label for="ed-table">표 내용</label>
      <textarea class="input mono" id="ed-table" rows="5" placeholder="엑셀이나 구글 시트에서 표를 복사해 여기에 붙여 넣어요.\n쉼표로 나눈 글(CSV)도 돼요.">${esc(tableToText(cur.rows || []))}</textarea>
      <div class="row" style="margin-top:8px"><label class="check"><input type="checkbox" id="ed-head" ${cur.head === false ? '' : 'checked'}> 첫 줄은 제목 줄</label><span class="spacer"></span>
      <label class="btn btn-cream btn-sm" for="ed-csv">${ICON.upload}CSV 파일 불러오기</label><input type="file" id="ed-csv" accept=".csv,text/csv,.tsv,.txt" class="hidden"></div></div>
      <div class="field"><div class="field-label" style="font-size:16px">미리 보기 <span class="fl-note">${LIMITS.tableRows}줄 · ${LIMITS.tableCols}칸까지</span></div><div id="ed-prev" class="ed-prev"></div></div>`;
  else if (kind === 'video')
    body = `${titleField}<div class="field"><label for="ed-url">영상 주소</label><input class="input" id="ed-url" inputmode="url" value="${esc(cur.url || '')}" placeholder="https://www.youtube.com/watch?v=… 또는 구글 드라이브 공유 링크" autocomplete="off"><div class="count" id="ed-hint"></div></div>
      <p class="fl-note" style="margin:0">유튜브 · 구글 드라이브 · 비메오 영상은 화면 안에서 바로 재생돼요. 영상 파일은 유튜브나 드라이브에 올린 뒤 링크를 넣어 주세요.</p>`;
  else if (kind === 'link')
    body = `${titleField}<div class="field"><label for="ed-url">주소</label><input class="input" id="ed-url" inputmode="url" value="${esc(cur.url || '')}" placeholder="https://…" autocomplete="off"></div>
      <div class="field"><label for="ed-desc">설명 <span class="fl-note">선택</span></label><input class="input" id="ed-desc" maxlength="80" value="${esc(cur.desc || '')}" autocomplete="off"></div>`;
  const md = openModal(`<div class="mat-editor"><h2>${matIcon(kind)} ${kind === 'video' ? '영상 링크' : matKindName(kind)} ${isNew ? '더하기' : '고치기'}</h2>
    <div class="stack" style="gap:14px">${body}</div>
    <div id="ed-err" aria-live="assertive"></div>
    <div class="actions"><button type="button" class="btn btn-cream" data-close>취소</button><button type="button" class="btn btn-primary" data-save>${isNew ? '더하기' : '고치기 완료'}</button></div></div>`, { wide: kind === 'table' || kind === 'text' });
  const el = md.el;
  const err = (msg) => ($('#ed-err', el).innerHTML = msg ? `<div class="notice apricot"><div>${esc(msg)}</div></div>` : '');
  if (kind === 'text') {
    const ta = $('#ed-text', el);
    const cnt = () => ($('#ed-count', el).textContent = `${ta.value.length} / ${LIMITS.textChars}자`);
    ta.addEventListener('input', cnt);
    cnt();
  }
  if (kind === 'table') {
    const ta = $('#ed-table', el);
    const prev = () => {
      const rows = parseTable(ta.value);
      $('#ed-prev', el).innerHTML = rows.length ? matBodyHtml({ kind: 'table', rows, head: $('#ed-head', el).checked }) : '<div class="mat-empty">붙여 넣으면 여기에 표가 보여요.</div>';
    };
    ta.addEventListener('input', prev);
    $('#ed-head', el).addEventListener('change', prev);
    $('#ed-csv', el).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (x) {
        text = new TextDecoder('euc-kr').decode(buf);
      }
      ta.value = tableToText(parseTable(text));
      if (!$('#ed-title', el).value) $('#ed-title', el).value = f.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.matTitle);
      prev();
    });
    prev();
  }
  if (kind === 'video') {
    const u = $('#ed-url', el);
    const hint = () => {
      const url = cleanUrl(u.value);
      $('#ed-hint', el).textContent = !u.value.trim() ? '' : !url ? '주소를 다시 확인해 주세요.' : videoEmbed(url) ? '✓ 화면 안에서 재생돼요' : '이 주소는 새 창에서 열려요';
    };
    u.addEventListener('input', hint);
    hint();
  }
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return md.close();
    if (!e.target.closest('[data-save]')) return;
    const title = $('#ed-title', el).value.trim().slice(0, LIMITS.matTitle);
    const next = { ...cur, title };
    if (kind === 'text') {
      next.text = $('#ed-text', el).value.trim().slice(0, LIMITS.textChars);
      if (!next.text) return err('글을 써 주세요.');
    } else if (kind === 'image') next.caption = $('#ed-cap', el).value.trim().slice(0, 80);
    else if (kind === 'table') {
      next.rows = parseTable($('#ed-table', el).value);
      next.head = $('#ed-head', el).checked;
      if (!next.rows.length) return err('표 내용을 붙여 넣어 주세요.');
    } else if (kind === 'video' || kind === 'link') {
      next.url = cleanUrl($('#ed-url', el).value);
      if (!next.url) return err('주소를 다시 확인해 주세요. (https:// 로 시작해요)');
      if (kind === 'link') next.desc = $('#ed-desc', el).value.trim().slice(0, 80);
    }
    if (upsertMaterial(next)) md.close();
  });
}

// ── 이미지 · PDF 고르기 ────────────────────────────

function chooseFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      resolve([...(inp.files || [])]);
      inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

function busy(title) {
  const md = openModal(`<h2>${esc(title)}</h2><p id="busy-msg">잠시만 기다려 주세요…</p><div class="progress" aria-hidden="true"><i id="busy-bar" style="width:0%"></i></div>`);
  return {
    set(msg, pct) {
      const m = $('#busy-msg', md.el);
      if (m) m.textContent = msg;
      const b = $('#busy-bar', md.el);
      if (b && pct !== undefined) b.style.width = `${Math.round(pct * 100)}%`;
    },
    close: md.close,
  };
}

async function pickImages() {
  const files = (await chooseFile('image/*', true)).filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  const room = LIMITS.images - imageCount();
  if (room <= 0) return toast(`그림은 ${LIMITS.images}장까지 올릴 수 있어요.`, 'warn');
  const list = files.slice(0, Math.min(room, LIMITS.materials - F.materials.length));
  const b = busy('이미지를 준비하는 중');
  let done = 0;
  for (const f of list) {
    b.set(`${done + 1} / ${list.length}장 줄이는 중…`, done / list.length);
    try {
      const data = await compressImage(f, 1600, 450000);
      const id = uid('m');
      const name = 'm-' + id.slice(1);
      await idbSet('dimg:' + name, { data, at: Date.now() });
      F.materials.push({ id, kind: 'image', title: f.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.matTitle), caption: '', img: name });
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'warn');
    }
    done++;
  }
  b.close();
  if (files.length > list.length) toast(`그림이 너무 많아서 ${list.length}장만 넣었어요.`, 'warn');
  drawMaterials();
  changed();
}

async function pickPdf() {
  const [file] = await chooseFile('application/pdf,.pdf');
  if (!file) return;
  if (F.materials.length >= LIMITS.materials) return toast(`자료는 ${LIMITS.materials}개까지 올릴 수 있어요.`, 'warn');
  const room = Math.min(LIMITS.pdfPages, LIMITS.images - imageCount());
  if (room <= 0) return toast(`그림은 ${LIMITS.images}장까지 올릴 수 있어요.`, 'warn');
  const b = busy('PDF를 그림으로 바꾸는 중');
  try {
    const res = await pdfToImages(file, { onPage: (i, n) => b.set(`${i} / ${n}쪽`, i / n) });
    const pages = res.pages.slice(0, room);
    const id = uid('m');
    const names = [];
    for (let i = 0; i < pages.length; i++) {
      const name = `m-${id.slice(1)}-${i + 1}`;
      await idbSet('dimg:' + name, { data: pages[i], at: Date.now() });
      names.push(name);
    }
    F.materials.push({ id, kind: 'pdf', title: file.name.replace(/\.pdf$/i, '').slice(0, LIMITS.matTitle), pages: names });
    b.close();
    const cut = res.skipped + (res.pages.length - pages.length);
    if (cut > 0) toast(`앞의 ${pages.length}쪽만 넣었어요. (PDF는 ${LIMITS.pdfPages}쪽까지)`, 'warn');
    drawMaterials();
    changed();
  } catch (e) {
    console.warn(e);
    b.close();
    toast('PDF를 열지 못했어요. 암호가 걸려 있거나 손상된 파일인지 확인해 주세요.', 'warn');
  }
}

// ── 렌즈 ───────────────────────────────────────────

function drawLenses() {
  const box = $('#lens-list');
  if (!box) return;
  const hide = new Set(F.prefs.hidden);
  box.innerHTML =
    allLenses()
      .map((l) => {
        const on = !hide.has(l.id);
        return `<div class="ls-card ${on ? '' : 'off'}" style="--lc:${l.color.main};--ls:${l.color.soft};--li:${l.color.ink}">
        <div class="ls-head"><span class="ls-name">${esc(l.name)}</span>${l.custom ? '<span class="chip cream" style="font-size:13px">추가한 렌즈</span>' : ''}<span class="spacer"></span>
          <label class="switch"><input type="checkbox" data-act="lens-toggle" data-id="${esc(l.id)}" ${on ? 'checked' : ''}><span>${on ? '보이기' : '숨기기'}</span></label></div>
        <div class="ls-desc">${esc(l.desc)}</div>
        <ul class="ls-frames">${l.frames.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${l.example ? `<div class="ls-ex">예) ${esc(l.example)}</div>` : ''}
        ${l.custom ? `<div class="row" style="gap:6px;margin-top:8px"><button type="button" class="btn btn-cream btn-sm" data-act="lens-edit" data-id="${esc(l.id)}">${ICON.edit}고치기</button><button type="button" class="btn btn-ghost btn-sm" data-act="lens-del" data-id="${esc(l.id)}">${ICON.trash}지우기</button></div>` : ''}
      </div>`;
      })
      .join('') +
    (F.prefs.custom.length < LIMITS.customLenses ? `<button type="button" class="ls-add" data-act="lens-add">${ICON.plus}<b>렌즈 추가</b><span>이름 · 뜻 · 질문 틀 · 예시</span></button>` : '');
}

function toggleLens(id) {
  const hide = new Set(F.prefs.hidden);
  if (hide.has(id)) hide.delete(id);
  else {
    if (visibleLenses().length <= 1) {
      drawLenses();
      return toast('렌즈는 하나 이상 보여야 해요.', 'warn');
    }
    hide.add(id);
  }
  F.prefs.hidden = [...hide];
  savePrefs();
  drawLenses();
  F.onChange();
}

function lensEditor(lens) {
  const isNew = !lens;
  const cur = lens ? { ...lens } : { id: uid('c'), name: '', desc: '', frames: ['', ''], example: '', custom: true };
  const md = openModal(`<div class="mat-editor"><h2>${isNew ? '렌즈 추가' : '렌즈 고치기'}</h2>
    <div class="stack" style="gap:12px">
      <div class="field"><label for="le-name">렌즈 이름</label><input class="input" id="le-name" maxlength="${LIMITS.lensName}" value="${esc(cur.name)}" placeholder="예: 시스템" autocomplete="off"></div>
      <div class="field"><label for="le-desc">한 줄 뜻</label><input class="input" id="le-desc" maxlength="${LIMITS.lensDesc}" value="${esc(cur.desc)}" placeholder="예: 여러 부분이 어떻게 함께 움직이는지 살펴봐요" autocomplete="off"></div>
      <div class="field"><label for="le-f1">질문 틀 <span class="fl-note">바꿔 쓸 자리는 ○○, △△로 써요</span></label>
        <input class="input" id="le-f1" maxlength="${LIMITS.lensFrame}" value="${esc(cur.frames[0] || '')}" placeholder="예: ○○은 어떤 부분으로 이루어져 있을까?" autocomplete="off">
        <input class="input" id="le-f2" maxlength="${LIMITS.lensFrame}" value="${esc(cur.frames[1] || '')}" placeholder="두 번째 질문 틀 · 선택" autocomplete="off" style="margin-top:8px"></div>
      <div class="field"><label for="le-ex">예시 질문 <span class="fl-note">선택</span></label><input class="input" id="le-ex" maxlength="${LIMITS.lensExample}" value="${esc(cur.example || '')}" autocomplete="off"></div>
      <div class="row" style="gap:6px"><button type="button" class="btn btn-ghost btn-sm" data-ins="○○">○○ 넣기</button><button type="button" class="btn btn-ghost btn-sm" data-ins="△△">△△ 넣기</button><span class="fl-note">누르면 질문 틀 칸에 들어가요</span></div>
    </div>
    <div id="le-err" aria-live="assertive"></div>
    <div class="actions"><button type="button" class="btn btn-cream" data-close>취소</button><button type="button" class="btn btn-primary" data-save>${isNew ? '추가하기' : '고치기 완료'}</button></div></div>`);
  const el = md.el;
  let lastFrame = $('#le-f1', el);
  ['#le-f1', '#le-f2'].forEach((s) => $(s, el).addEventListener('focus', (e) => (lastFrame = e.target)));
  el.addEventListener('click', (e) => {
    const ins = e.target.closest('[data-ins]');
    if (ins) {
      const inp = lastFrame;
      const a = inp.selectionStart ?? inp.value.length;
      const b2 = inp.selectionEnd ?? inp.value.length;
      inp.value = (inp.value.slice(0, a) + ins.dataset.ins + inp.value.slice(b2)).slice(0, LIMITS.lensFrame);
      inp.focus();
      return;
    }
    if (e.target.closest('[data-close]')) return md.close();
    if (!e.target.closest('[data-save]')) return;
    const name = $('#le-name', el).value.trim();
    const desc = $('#le-desc', el).value.trim();
    const frames = [$('#le-f1', el).value.trim(), $('#le-f2', el).value.trim()].filter(Boolean);
    const errBox = $('#le-err', el);
    if (!name) return (errBox.innerHTML = '<div class="notice apricot"><div>렌즈 이름을 써 주세요.</div></div>');
    if (!frames.length) return (errBox.innerHTML = '<div class="notice apricot"><div>질문 틀을 하나 이상 써 주세요.</div></div>');
    if (allLenses().some((l) => l.name === name && l.id !== cur.id)) return (errBox.innerHTML = '<div class="notice apricot"><div>같은 이름의 렌즈가 있어요.</div></div>');
    const next = { ...cur, name, desc, frames, example: $('#le-ex', el).value.trim(), custom: true };
    if (!next.color) {
      const used = new Set(F.prefs.custom.map((l) => l.color && l.color.main));
      next.color = CUSTOM_COLORS.find((c) => !used.has(c.main)) || CUSTOM_COLORS[F.prefs.custom.length % CUSTOM_COLORS.length];
    }
    const i = F.prefs.custom.findIndex((l) => l.id === cur.id);
    if (i >= 0) F.prefs.custom[i] = next;
    else F.prefs.custom.push(next);
    savePrefs();
    drawLenses();
    F.onChange();
    md.close();
  });
}

async function delLens(id) {
  const l = F.prefs.custom.find((x) => x.id === id);
  if (!l) return;
  const ok = await confirmBox({ title: `「${l.name}」 렌즈를 지울까요?`, body: '이 컴퓨터에 기억해 둔 렌즈에서 지워요. 이미 만든 게임에는 남아 있어요.', ok: '지우기', danger: true });
  if (!ok) return;
  F.prefs.custom = F.prefs.custom.filter((x) => x.id !== id);
  F.prefs.hidden = F.prefs.hidden.filter((x) => x !== id);
  if (!visibleLenses().length) F.prefs.hidden = [];
  savePrefs();
  drawLenses();
  F.onChange();
}

// ── 연습 그림 ───────────────────────────────────────

function drawPictures() {
  const box = $('#pic-list');
  if (!box) return;
  const off = new Set(F.prefs.picOff);
  const items = BUILTIN_PICTURES.map((p) => ({ ...p, builtin: true })).concat(F.prefs.pictures.map((p) => ({ ...p, img: p.id })));
  box.innerHTML =
    items
      .map((p) => {
        const on = !off.has(p.id);
        const img = p.builtin ? `<img src="${esc(p.thumb)}" alt="">` : `<img data-img="${esc(p.id)}" alt="">`;
        return `<div class="pc-card ${on ? '' : 'off'}">
          <div class="pc-img">${img}</div>
          <div class="pc-body"><b>${esc(p.title)}</b><span>${esc(p.hint || '')}</span></div>
          <div class="row" style="gap:6px;padding:0 12px 12px">
            <label class="switch"><input type="checkbox" data-act="pic-toggle" data-id="${esc(p.id)}" ${on ? 'checked' : ''}><span>${on ? '쓰기' : '빼기'}</span></label>
            <span class="spacer"></span>
            ${p.builtin ? '<span class="chip cream" style="font-size:13px">1차시 그림</span>' : `<button type="button" class="btn btn-ghost btn-icon" data-act="pic-del" data-id="${esc(p.id)}" aria-label="지우기">${ICON.trash}</button>`}
          </div>
        </div>`;
      })
      .join('') +
    (F.prefs.pictures.length < LIMITS.customPictures ? `<button type="button" class="pc-add" data-act="pic-add">${ICON.plus}<b>그림 추가</b><span>그림 · 제목 · 한 줄 설명</span></button>` : '');
  hydrate(box, (name) => picImg(name));
}

function togglePic(id) {
  const off = new Set(F.prefs.picOff);
  if (off.has(id)) off.delete(id);
  else {
    if (visiblePictures().length <= 1) {
      drawPictures();
      return toast('연습 그림은 하나 이상 골라 주세요.', 'warn');
    }
    off.add(id);
  }
  F.prefs.picOff = [...off];
  savePrefs();
  drawPictures();
  F.onChange();
}

function pictureEditor() {
  let data = null;
  const md = openModal(`<div class="mat-editor"><h2>연습 그림 추가</h2>
    <div class="stack" style="gap:12px">
      <label class="drop" id="pe-drop" for="pe-file">${ICON.image}<b>그림 고르기</b><span>사진이나 그림 파일을 골라요</span></label>
      <input type="file" id="pe-file" accept="image/*" class="hidden">
      <div class="field"><label for="pe-title">제목</label><input class="input" id="pe-title" maxlength="20" autocomplete="off" placeholder="예: 바닷가의 빈 병"></div>
      <div class="field"><label for="pe-hint">한 줄 설명 <span class="fl-note">선택</span></label><input class="input" id="pe-hint" maxlength="40" autocomplete="off" placeholder="예: 모래사장에 놓인 오래된 유리병"></div>
    </div>
    <div id="pe-err" aria-live="assertive"></div>
    <div class="actions"><button type="button" class="btn btn-cream" data-close>취소</button><button type="button" class="btn btn-primary" data-save>추가하기</button></div></div>`);
  const el = md.el;
  $('#pe-file', el).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      data = await compressImage(f, 1400, 380000);
      $('#pe-drop', el).innerHTML = `<img src="${data}" alt="고른 그림" style="max-height:180px;border-radius:14px">`;
      if (!$('#pe-title', el).value) $('#pe-title', el).value = f.name.replace(/\.[^.]+$/, '').slice(0, 20);
    } catch (x) {
      $('#pe-err', el).innerHTML = `<div class="notice apricot"><div>${esc(x.message)}</div></div>`;
    }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return md.close();
    if (!e.target.closest('[data-save]')) return;
    const title = $('#pe-title', el).value.trim();
    if (!data) return ($('#pe-err', el).innerHTML = '<div class="notice apricot"><div>그림을 골라 주세요.</div></div>');
    if (!title) return ($('#pe-err', el).innerHTML = '<div class="notice apricot"><div>제목을 써 주세요.</div></div>');
    const id = 'p-' + uid().slice(0, 8);
    await idbSet('pic:' + id, { data, at: Date.now() });
    F.prefs.pictures.push({ id, title, hint: $('#pe-hint', el).value.trim() });
    savePrefs();
    drawPictures();
    F.onChange();
    md.close();
  });
}

async function delPic(id) {
  const p = F.prefs.pictures.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmBox({ title: `「${p.title}」 그림을 지울까요?`, body: '이 컴퓨터에 기억해 둔 연습 그림에서 지워요.', ok: '지우기', danger: true });
  if (!ok) return;
  F.prefs.pictures = F.prefs.pictures.filter((x) => x.id !== id);
  F.prefs.picOff = F.prefs.picOff.filter((x) => x !== id);
  idbDel('pic:' + id);
  savePrefs();
  drawPictures();
  F.onChange();
}

// 새로 시작하기: 프로젝트 이름과 자료를 비운다 (렌즈 · 연습 그림 설정은 그대로)
export async function clearDraft() {
  F.materials.forEach((m) => matImages(m).forEach((name) => idbDel('dimg:' + name)));
  F.title = '';
  F.intro = '';
  F.materials = [];
  await idbSet(DRAFT_KEY, { title: '', intro: '', materials: [], at: Date.now() });
}

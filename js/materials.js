// 선생님 자료: 글 · 이미지 · PDF · 표 · 영상 링크 · 링크
//  - 선생님 화면(크게 띄우기)과 학생 화면(자료 보기)이 같은 그림을 쓴다.
//  - 그림은 <img data-img="이름">으로 그려 두고, hydrate()가 서버(또는 이 브라우저)에서 받아 채운다.

import { esc, ICON } from './ui.js';
import { LIMITS, MAT_KINDS } from './lenses.js';

export function matIcon(kind) {
  const k = (MAT_KINDS[kind] && MAT_KINDS[kind].icon) || 'text';
  return ICON[k] || ICON.text;
}

export function matKindName(kind) {
  return (MAT_KINDS[kind] && MAT_KINDS[kind].name) || '자료';
}

export function matTitle(m, i) {
  return (m && m.title) || `${matKindName(m && m.kind)} ${i !== undefined ? i + 1 : ''}`.trim();
}

// 자료의 그림 이름들 (이미지 1장, PDF는 쪽마다)
export function matImages(m) {
  if (!m) return [];
  if (m.kind === 'image' && m.img) return [m.img];
  if (m.kind === 'pdf') return (m.pages || []).slice();
  return [];
}

// ── 영상 링크 → 화면 안에서 재생할 주소 ──────────────────

export function videoEmbed(raw) {
  const url = String(raw || '').trim();
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  if (m) {
    const t = url.match(/[?&](?:t|start)=(\d+)/);
    return { type: 'youtube', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0${t ? '&start=' + t[1] : ''}`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  }
  m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]{10,})/);
  if (m) return { type: 'drive', src: `https://drive.google.com/file/d/${m[1]}/preview` };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  if (m) return { type: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}` };
  return null;
}

export function cleanUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.toString();
  } catch (e) {
    return '';
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// ── 표: 엑셀에서 복사한 글(탭) 또는 CSV ─────────────────

export function parseTable(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src.trim()) return [];
  const tab = src.includes('\t');
  const rows = [];
  if (tab) {
    src.split('\n').forEach((line) => rows.push(line.split('\t')));
  } else {
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    row.push(cell);
    rows.push(row);
  }
  const clean = rows
    .slice(0, LIMITS.tableRows)
    .map((r) => r.slice(0, LIMITS.tableCols).map((c) => String(c).replace(/\s+/g, ' ').trim().slice(0, LIMITS.cell)))
    .filter((r) => r.some((c) => c));
  const cols = Math.max(0, ...clean.map((r) => r.length));
  return clean.map((r) => r.concat(Array(cols - r.length).fill('')));
}

export function tableToText(rows) {
  return (rows || []).map((r) => r.join('\t')).join('\n');
}

// ── PDF → 쪽마다 그림 (선생님 브라우저에서만) ────────────

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).toString();
      return lib;
    });
  }
  return pdfjsPromise;
}

function canvasJpeg(canvas, maxChars) {
  let q = 0.85;
  let data = canvas.toDataURL('image/jpeg', q);
  while (data.length > maxChars && q > 0.4) {
    q -= 0.08;
    data = canvas.toDataURL('image/jpeg', q);
  }
  return data;
}

// onPage(done, total)
export async function pdfToImages(file, { maxWidth = 1400, maxChars = 600000, onPage } = {}) {
  const lib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).toString(),
    cMapPacked: true,
    useSystemFonts: true,
  }).promise;
  const total = Math.min(doc.numPages, LIMITS.pdfPages);
  const out = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, maxWidth / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(canvasJpeg(canvas, maxChars));
    page.cleanup();
    if (onPage) onPage(i, total);
  }
  const more = doc.numPages - total;
  doc.destroy();
  return { pages: out, skipped: more };
}

// ── 그리기 ─────────────────────────────────────────

function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function tableHtml(rows, head = true) {
  if (!rows || !rows.length) return '<p class="mat-empty">표가 비어 있어요.</p>';
  const [first, ...rest] = rows;
  const tr = (r, tag) => `<tr>${r.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
  return `<div class="mat-table-wrap"><table class="mat-table">${head ? `<thead>${tr(first, 'th')}</thead>` : ''}<tbody>${(head ? rest : rows).map((r) => tr(r, 'td')).join('')}</tbody></table></div>`;
}

// 자료 하나를 크게 보여 주는 내용 (보는 칸 · 크게 띄우기 · 학생 자료 보기)
export function matBodyHtml(m, { page = 0, big = false } = {}) {
  if (!m) return '<div class="mat-empty">자료가 없어요.</div>';
  switch (m.kind) {
    case 'text':
      return `<div class="mat-text ${big ? 'big' : ''}">${paragraphs(m.text)}</div>`;
    case 'image':
      return `<figure class="mat-figure"><img data-img="${esc(m.img)}" alt="${esc(m.title || '자료 그림')}" data-zoom>${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`;
    case 'pdf': {
      const pages = m.pages || [];
      const p = Math.max(0, Math.min(pages.length - 1, page));
      return `<div class="mat-pdf" data-mid="${esc(m.id)}" data-page="${p}">
        <figure class="mat-figure"><img data-img="${esc(pages[p] || '')}" alt="${esc(matTitle(m))} ${p + 1}쪽" data-zoom></figure>
        ${pages.length > 1 ? `<div class="pdf-nav"><button type="button" class="btn btn-cream btn-sm" data-act="pdf-prev" ${p <= 0 ? 'disabled' : ''} aria-label="앞 쪽">${ICON.left}</button><span><b>${p + 1}</b> / ${pages.length}쪽</span><button type="button" class="btn btn-cream btn-sm" data-act="pdf-next" ${p >= pages.length - 1 ? 'disabled' : ''} aria-label="다음 쪽">${ICON.right}</button></div>` : ''}
      </div>`;
    }
    case 'table':
      return tableHtml(m.rows, m.head !== false);
    case 'video': {
      const e = videoEmbed(m.url);
      if (e)
        return `<div class="mat-video"><iframe src="${esc(e.src)}" title="${esc(m.title || '영상')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>
          <p class="mat-note">영상이 보이지 않으면 <a href="${esc(m.url)}" target="_blank" rel="noopener">새 창에서 보기</a></p>`;
      return linkCard(m, '영상');
    }
    case 'link':
      return linkCard(m, '링크');
    default:
      return '<div class="mat-empty">볼 수 없는 자료예요.</div>';
  }
}

function linkCard(m, label) {
  return `<div class="mat-link">
    <div class="ml-icon">${m.kind === 'video' ? ICON.video : ICON.link}</div>
    <div class="ml-body"><div class="ml-host">${esc(hostOf(m.url))}</div>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}</div>
    <a class="btn btn-primary" href="${esc(m.url)}" target="_blank" rel="noopener">${label} 새 창에서 열기</a>
  </div>`;
}

// 목록 · 썸네일용 작은 그림
export function matThumbHtml(m) {
  if (m.kind === 'image' && m.img) return `<img data-img="${esc(m.img)}" alt="">`;
  if (m.kind === 'pdf' && m.pages && m.pages[0]) return `<img data-img="${esc(m.pages[0])}" alt="">`;
  if (m.kind === 'video') {
    const e = videoEmbed(m.url);
    // 유튜브가 막힌 학교에서는 썸네일이 안 보이므로, 그림을 못 받으면 지우고 아이콘이 보이게 한다
    if (e && e.thumb) return `<span class="th-icon">${matIcon('video')}</span><img class="th-vid" src="${esc(e.thumb)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
  }
  return `<span class="th-icon">${matIcon(m.kind)}</span>`;
}

// 자료 한 줄 설명 (목록용)
export function matSummary(m) {
  switch (m.kind) {
    case 'text':
      return String(m.text || '').replace(/\s+/g, ' ').slice(0, 60);
    case 'image':
      return m.caption || '이미지';
    case 'pdf':
      return `PDF ${(m.pages || []).length}쪽`;
    case 'table':
      return `표 ${(m.rows || []).length}줄`;
    case 'video':
      return videoEmbed(m.url) ? '영상 · 화면 안에서 재생' : '영상 링크 · 새 창에서 열기';
    case 'link':
      return hostOf(m.url) || '링크';
    default:
      return '';
  }
}

// <img data-img> 채우기. getSrc(name) → Promise<data URL>
export function hydrate(root, getSrc) {
  if (!root) return;
  root.querySelectorAll('img[data-img]').forEach((img) => {
    const name = img.dataset.img;
    if (!name || img.dataset.loaded === name) return;
    img.dataset.loaded = name;
    img.classList.add('loading');
    Promise.resolve(getSrc(name))
      .then((src) => {
        if (img.dataset.img !== name) return;
        if (src) img.src = src;
        else img.classList.add('missing');
      })
      .catch(() => {
        img.classList.add('missing');
        img.dataset.loaded = '';
      })
      .finally(() => img.classList.remove('loading'));
  });
}

// PDF 쪽 넘기기 (보는 칸 안에서) → 새 쪽 번호
export function pdfStep(box, mats, dir) {
  const el = box.querySelector('.mat-pdf');
  if (!el) return null;
  const m = mats.find((x) => x.id === el.dataset.mid);
  if (!m) return null;
  const p = Math.max(0, Math.min((m.pages || []).length - 1, Number(el.dataset.page) + dir));
  return { m, page: p };
}

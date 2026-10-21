// 질문 카드 끌어 놓기 (손가락 · 마우스 · 펜 모두 Pointer Events로) · 4차시: 프로젝트 탐구 질문 칸에 놓기
//  - 카드를 끌어서 [data-zone] 자리에 놓으면 onDrop(id, zone)
//  - 카드를 톡 누르면 onTap(id) → 선택한 뒤 놓을 자리를 누르는 방법도 쓸 수 있다 (onZoneTap)
//  - 바구니처럼 안에서 위아래로 넘기는 목록은, 위아래로 밀면 넘기고 옆으로 밀면 끌기 시작한다
//  - 끄는 동안 화면 위·아래 끝에 가까이 가면 화면이 저절로 움직인다

const START_PX = 7;

export function enableDnd(root, { onDrop, onTap, onZoneTap, canDrag = () => true, keys = null }) {
  let st = null;
  let raf = 0;

  const zoneAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-zone]') : null;
  };

  function setOver(z) {
    if (st.over === z) return;
    if (st.over) st.over.classList.remove('over');
    st.over = z;
    if (z) z.classList.add('over');
  }

  function autoScroll() {
    if (!st || !st.dragging) return;
    const edge = 70;
    const y = st.y;
    let dy = 0;
    if (y < edge) dy = -Math.ceil((edge - y) / 5);
    else if (y > innerHeight - edge) dy = Math.ceil((y - (innerHeight - edge)) / 5);
    // 바구니 목록 안에서 끌 때는 목록을 움직인다
    const list = st.over && st.over.classList.contains('basket') ? st.over.querySelector('.basket-list') : null;
    if (list && list.scrollHeight > list.clientHeight) {
      const r = list.getBoundingClientRect();
      if (st.y < r.top + 50) list.scrollTop -= 8;
      else if (st.y > r.bottom - 50) list.scrollTop += 8;
    }
    if (dy) window.scrollBy(0, dy);
    raf = requestAnimationFrame(autoScroll);
  }

  function startDrag() {
    const r = st.card.getBoundingClientRect();
    const g = st.card.cloneNode(true);
    g.classList.add('ghost');
    g.classList.remove('selected', 'pop');
    g.style.width = r.width + 'px';
    g.style.left = '0px';
    g.style.top = '0px';
    st.offX = st.x0 - r.left;
    st.offY = st.y0 - r.top;
    document.body.appendChild(g);
    st.ghost = g;
    st.dragging = true;
    st.card.classList.add('lifting');
    root.classList.add('is-dragging');
    moveGhost();
    raf = requestAnimationFrame(autoScroll);
  }

  function moveGhost() {
    st.ghost.style.transform = `translate(${st.x - st.offX}px, ${st.y - st.offY}px) rotate(-2deg)`;
    setOver(zoneAt(st.x, st.y));
  }

  function end(commit) {
    if (!st) return;
    cancelAnimationFrame(raf);
    const s = st;
    st = null;
    if (s.ghost) s.ghost.remove();
    if (s.over) s.over.classList.remove('over');
    s.card.classList.remove('lifting');
    root.classList.remove('is-dragging');
    try {
      s.card.releasePointerCapture(s.pid);
    } catch (e) {}
    if (!commit) return;
    if (s.dragging) {
      const z = zoneAt(s.x, s.y);
      if (z) onDrop(s.id, z.dataset.zone);
    } else if (!s.scrolling && onTap) onTap(s.id);
  }

  root.addEventListener('pointerdown', (e) => {
    if (st || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const card = e.target.closest('.qcard');
    if (!card || e.target.closest('button') || !root.contains(card) || !canDrag()) return;
    const list = card.closest('.basket-list, [data-scroll-list]');
    st = {
      pid: e.pointerId,
      card,
      id: card.dataset.id,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      list: list && list.scrollHeight > list.clientHeight + 2 ? list : null,
      scroll0: list ? list.scrollTop : 0,
      dragging: false,
      scrolling: false,
      over: null,
    };
    try {
      card.setPointerCapture(e.pointerId);
    } catch (err) {}
  });

  root.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.pid) return;
    st.x = e.clientX;
    st.y = e.clientY;
    const dx = st.x - st.x0;
    const dy = st.y - st.y0;
    if (st.dragging) {
      e.preventDefault();
      moveGhost();
      return;
    }
    if (st.scrolling) {
      st.list.scrollTop = st.scroll0 - dy;
      return;
    }
    if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
    // 목록 안에서 위아래로 밀면 넘기기, 그 밖에는 끌기
    if (st.list && Math.abs(dy) > Math.abs(dx) * 1.3 && e.pointerType !== 'mouse') {
      st.scrolling = true;
      st.list.scrollTop = st.scroll0 - dy;
      return;
    }
    startDrag();
  });

  root.addEventListener('pointerup', (e) => {
    if (st && e.pointerId === st.pid) end(true);
  });
  root.addEventListener('pointercancel', (e) => {
    if (st && e.pointerId === st.pid) end(false);
  });

  // 선택한 카드를 놓을 자리를 톡 누르기
  root.addEventListener('click', (e) => {
    if (!onZoneTap || e.target.closest('.qcard') || e.target.closest('button, input, textarea, select, a')) return;
    const z = e.target.closest('[data-zone]');
    if (z && root.contains(z)) onZoneTap(z.dataset.zone);
  });

  // 키보드: 카드에서 숫자 키로 바로 놓기 (keys = { '1': 'zone' … }), Enter · 스페이스는 고르기
  root.addEventListener('keydown', (e) => {
    const card = e.target.closest && e.target.closest('.qcard');
    if (!card || !canDrag()) return;
    const map = keys || {};
    if (map[e.key]) {
      e.preventDefault();
      onDrop(card.dataset.id, map[e.key]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onTap) onTap(card.dataset.id);
    }
  });

  return { cancel: () => end(false) };
}

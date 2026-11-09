const header = document.querySelector('.site-header');

function updateHeaderHeight() {
  document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
}

updateHeaderHeight();
new ResizeObserver(updateHeaderHeight).observe(header);

const dialog = document.querySelector('#link-dialog');

for (const button of document.querySelectorAll('[data-link-pending]')) {
  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
}

dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;

  const { left, right, top, bottom } = dialog.getBoundingClientRect();
  const outside = event.clientX < left || event.clientX > right ||
    event.clientY < top || event.clientY > bottom;
  if (outside) dialog.close();
});

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Появление блоков при прокрутке ---------- */
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

  for (const el of document.querySelectorAll('.section-head, .project, .about-item, .contact-content')) {
    el.classList.add('reveal');
    revealObserver.observe(el);
  }
}

/* ---------- Окно просмотра ---------- */
const viewer = document.querySelector('#viewer');
const viewerImg = viewer.querySelector('.viewer__img');
const viewerCaption = viewer.querySelector('.viewer__caption');
let viewerState = null;

function showViewerItem() {
  const { group, index } = viewerState;
  const item = group.originals[index];
  const thumb = item.querySelector('img');
  viewerImg.classList.add('is-loading');
  viewerImg.onload = () => viewerImg.classList.remove('is-loading');
  viewerImg.alt = thumb.alt;
  viewerImg.src = thumb.currentSrc || thumb.src;
  viewerCaption.textContent = `${group.label} ${index + 1} / ${group.originals.length}`;
}

function openViewer(group, index) {
  viewerState = { group, index, startIndex: index };
  showViewerItem();
  if (!viewer.open) viewer.showModal();
}

function stepViewer(dir) {
  if (!viewerState) return;
  const count = viewerState.group.originals.length;
  viewerState.index = (viewerState.index + dir + count) % count;
  showViewerItem();
}

viewer.querySelector('[data-viewer-close]').addEventListener('click', () => viewer.close());
for (const btn of viewer.querySelectorAll('[data-viewer-step]')) {
  btn.addEventListener('click', () => stepViewer(Number(btn.dataset.viewerStep)));
}
viewer.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') stepViewer(-1);
  if (event.key === 'ArrowRight') stepViewer(1);
});
viewer.addEventListener('click', event => {
  if (event.target !== viewer) return;
  const { left, right, top, bottom } = viewer.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) viewer.close();
});
viewer.addEventListener('close', () => {
  if (viewerState && viewerState.index !== viewerState.startIndex) viewerState.group.centerOn(viewerState.index);
  if (viewerState) viewerState.group.touch();
  viewerState = null;
});

/* ---------- Карусели ---------- */
const AUTO_SPEED = 22;      // пикселей в секунду
const IDLE_DELAY = 1800;    // пауза после действий пользователя, мс

function initCarousel(root) {
  const track = root.querySelector('.carousel__track');
  const row = root.querySelector('.carousel__row');
  const originals = Array.from(row.children);
  originals.forEach((el, i) => { el.dataset.index = i; });

  let loop = 0;
  let pos = 0;
  let lastTime = 0;
  let rafId = 0;
  let activeEl = null;
  let lastScrollLeft = -1;
  let hovering = false;
  let focused = false;
  let visible = false;
  let pressed = false;
  let dragging = false;
  let moved = false;
  let dragStartX = 0;
  let dragStartScroll = 0;
  let lastInteract = -Infinity;
  let buildQueued = false;

  const group = {
    originals,
    label: root.dataset.label || '',
    touch() { lastInteract = performance.now(); },
    centerOn(index) {
      if (!loop) return;
      const el = originals[index];
      const left = loop + el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2;
      track.scrollTo({ left, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  };

  function build() {
    buildQueued = false;
    const oldLoop = loop;
    const rel = oldLoop ? ((track.scrollLeft % oldLoop) + oldLoop) % oldLoop : 0;

    row.querySelectorAll('[data-clone]').forEach(node => node.remove());
    loop = row.scrollWidth;
    if (!loop) return;

    const sets = 2 + Math.ceil(track.clientWidth / loop);
    for (let s = 1; s < sets; s++) {
      for (const el of originals) {
        const clone = el.cloneNode(true);
        clone.dataset.clone = '';
        clone.tabIndex = -1;
        clone.setAttribute('aria-hidden', 'true');
        row.append(clone);
      }
    }
    track.scrollLeft = loop + Math.min(rel, loop - 1);
    pos = track.scrollLeft;
    lastScrollLeft = -1;
    updateActive();
  }

  function queueBuild() {
    if (buildQueued) return;
    buildQueued = true;
    requestAnimationFrame(build);
  }

  function wrap() {
    if (!loop) return false;
    const sl = track.scrollLeft;
    if (sl < loop) { track.scrollLeft = sl + loop; return true; }
    if (sl >= loop * 2) { track.scrollLeft = sl - loop; return true; }
    return false;
  }

  function updateActive() {
    const sl = track.scrollLeft;
    if (sl === lastScrollLeft) return;
    lastScrollLeft = sl;
    const center = sl + track.clientWidth / 2;
    let best = null;
    let bestDist = Infinity;
    for (const el of row.children) {
      const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
      if (dist < bestDist) { bestDist = dist; best = el; }
    }
    if (best !== activeEl) {
      if (activeEl) activeEl.classList.remove('is-active');
      if (best) best.classList.add('is-active');
      activeEl = best;
    }
  }

  function shouldRun(now) {
    return !reduceMotion.matches && visible && !hovering && !focused &&
      !dragging && !pressed && !viewer.open && now - lastInteract > IDLE_DELAY;
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (loop && shouldRun(now)) {
      pos += AUTO_SPEED * dt;
      if (pos >= loop * 2) pos -= loop;
      track.scrollLeft = pos;
    } else {
      pos = track.scrollLeft;
    }
    updateActive();
  }

  function start() {
    if (rafId) return;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) start(); else stop();
  }, { threshold: 0.05 }).observe(root);

  new ResizeObserver(queueBuild).observe(track);
  for (const img of row.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', queueBuild, { once: true });
  }

  track.addEventListener('scroll', () => {
    if (wrap()) pos = track.scrollLeft;
    updateActive();
  }, { passive: true });

  root.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hovering = true; });
  root.addEventListener('pointerleave', () => {
    hovering = false;
    lastInteract = performance.now();
  });
  root.addEventListener('focusin', e => { focused = e.target.matches(':focus-visible'); });
  root.addEventListener('focusout', () => { focused = false; });
  for (const type of ['touchstart', 'keydown']) {
    root.addEventListener(type, () => { lastInteract = performance.now(); }, { passive: true });
  }

  // Колесо мыши над лентой листает её по горизонтали
  track.addEventListener('wheel', e => {
    if (e.ctrlKey) return;
    lastInteract = performance.now();
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      track.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    }
  }, { passive: false });

  // Перетаскивание мышью
  track.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    pressed = true;
    moved = false;
    dragStartX = e.clientX;
    dragStartScroll = track.scrollLeft;
  });
  track.addEventListener('pointermove', e => {
    if (!pressed) return;
    const dx = e.clientX - dragStartX;
    if (!dragging && Math.abs(dx) > 5) {
      dragging = true;
      moved = true;
      track.setPointerCapture(e.pointerId);
      root.classList.add('is-dragging');
    }
    if (dragging) track.scrollLeft = dragStartScroll - dx;
  });
  const endDrag = () => {
    if (!pressed) return;
    pressed = false;
    dragging = false;
    root.classList.remove('is-dragging');
    lastInteract = performance.now();
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);

  // Клик по работе — открыть просмотр (после перетаскивания клик гасим)
  track.addEventListener('click', e => {
    if (moved) {
      e.stopPropagation();
      e.preventDefault();
      moved = false;
    }
  }, true);
  row.addEventListener('click', e => {
    const item = e.target.closest('.carousel__item');
    if (item) openViewer(group, Number(item.dataset.index));
  });

  build();
}

for (const root of document.querySelectorAll('[data-carousel]')) initCarousel(root);

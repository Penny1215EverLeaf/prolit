/* ============================================================
   CircularGallery — vanilla JS/CSS 复刻 React Bits 圆弧画廊动效
   ------------------------------------------------------------
   · 弧线排布 (bend / arcOf)、滚动缓动 (scrollEase)、吸附 (snap)
   · 拖拽 / 滚轮 / 键盘、边缘淡出 (fadeEdges)、入场 (intro)
   · 点击卡片从原位置放大到全貌 (openOnClick)：
       图片 → 完整原图，主图的 prompt 截图在下方附加展示
       视频 → 就地播放（controls + autoplay）
   · 纯 DOM + CSS transform，不依赖 WebGL，file:// 直开可用
   ============================================================ */
(function () {
  'use strict';

  var WORLD_HEIGHT = 16.57;
  var INTRO_SECONDS = 1.4;

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function ease(v) { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); }
  function smoother(x) { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }
  function wrap(v, n) { return ((v % n) + n) % n; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function CircularGallery(host, opts) {
    opts = opts || {};
    var s = {
      items: opts.items || [],
      bend: opts.bend == null ? 3 : opts.bend,
      itemSize: clamp(opts.itemSize == null ? 0.72 : opts.itemSize, 0.2, 2),
      itemAspect: clamp(opts.itemAspect == null ? 0.78 : opts.itemAspect, 0.2, 5),
      gap: Math.max(0, opts.gap == null ? 0.26 : opts.gap),
      fadeEdges: clamp(opts.fadeEdges == null ? 0.12 : opts.fadeEdges, 0, 0.5),
      scrollSpeed: Math.max(0, opts.scrollSpeed == null ? 2 : opts.scrollSpeed),
      scrollEase: clamp(opts.scrollEase == null ? 0.05 : opts.scrollEase, 0.001, 1),
      snap: opts.snap !== false,
      autoScroll: opts.autoScroll == null ? 0.18 : opts.autoScroll,
      intro: opts.intro !== false,
      onActiveChange: opts.onActiveChange || null,
      onItemClick: opts.onItemClick || null,
      onOpen: opts.onOpen || null,
      onClose: opts.onClose || null
    };

    /* ---------- DOM ---------- */
    host.classList.add('rg-root');
    host.innerHTML =
      '<div class="rg-stage"><div class="rg-belt"></div></div>' +
      '<div class="rg-viewer" hidden>' +
        '<div class="rg-viewer-bg"></div>' +
        '<div class="rg-viewer-frame">' +
          '<div class="rg-viewer-media"></div>' +
          '<div class="rg-attach"></div>' +
        '</div>' +
        '<button class="rg-close" type="button" aria-label="返回画廊">↩ 返回</button>' +
        '<button class="rg-vnav prev" type="button" aria-label="上一项">←</button>' +
        '<button class="rg-vnav next" type="button" aria-label="下一项">→</button>' +
        '<div class="rg-vcount"></div>' +
      '</div>';

    var belt = host.querySelector('.rg-belt');
    var stage = host.querySelector('.rg-stage');
    var viewer = host.querySelector('.rg-viewer');
    var viewerBg = host.querySelector('.rg-viewer-bg');
    var mediaBox = host.querySelector('.rg-viewer-media');
    var attachBox = host.querySelector('.rg-attach');
    var vcount = host.querySelector('.rg-vcount');
    var closeBtn = host.querySelector('.rg-close');
    var prevBtn = host.querySelector('.rg-vnav.prev');
    var nextBtn = host.querySelector('.rg-vnav.next');

    var view = { w: 1, h: 1 };
    var met = { w: 1, h: 1, spacing: 1 };
    var cards = [];
    var listeners = [];
    var state = {
      scroll: 0, target: 0, velocity: 0,
      intro: 1, active: 0, spacing: 1,
      drag: null, suppressClick: false, lastInput: Date.now(), hovered: null,
      raf: 0, last: 0, snapTimer: 0, frames: 0,
      open: false, openSlot: 0, attachIndex: 0, viewerItem: null
    };
    var destroyed = false;

    function listen(node, type, fn, opt) {
      node.addEventListener(type, fn, opt || false);
      listeners.push(function () { node.removeEventListener(type, fn, opt || false); });
    }

    /* ---------- 几何：measure / arcOf / fade ---------- */
    function measure() {
      var small = view.w < 700 ? 0.55 : 1;
      var h0 = 0.6 * view.h * s.itemSize * small;
      var w0 = h0 * s.itemAspect;
      var sc = Math.min(1, (view.w * 0.82) / w0);
      var w = w0 * sc, h = h0 * sc;
      return { w: w, h: h, spacing: w * (1 + s.gap) };
    }
    function arcOf(x) {
      if (!s.bend) return { y: 0, angle: 0 };
      var depth = Math.abs(s.bend) * view.h / WORLD_HEIGHT;
      var half = Math.max(view.w, view.h * 1.9) / 2;
      var radius = (half * half + depth * depth) / (2 * depth);
      var reach = Math.min(Math.abs(x), half, radius * 0.999);
      var arc = radius - Math.sqrt(Math.max(0, radius * radius - reach * reach));
      var angle = (x < 0 ? -1 : 1) * Math.asin(clamp(reach / radius, 0, 1));
      return s.bend > 0 ? { y: -arc, angle: -angle } : { y: arc, angle: angle };
    }
    function edgeFade(u) {
      if (s.fadeEdges <= 0) return 1;
      return smoother(clamp(u / s.fadeEdges, 0, 1)) *
             smoother(clamp((1 - u) / s.fadeEdges, 0, 1));
    }

    /* ---------- 卡片池 ---------- */
    function ensurePool() {
      var size = Math.ceil(view.w / Math.max(met.spacing, 1)) + 8;
      if (cards.length === size) return;
      belt.innerHTML = ''; cards = [];
      for (var i = 0; i < size; i++) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'rg-card';
        el.setAttribute('aria-label', '查看物料');
        el.innerHTML = '<img alt=""><span class="rg-play">▶</span><span class="rg-live">LIVE</span>';
        var c = { el: el, img: el.querySelector('img'), play: el.querySelector('.rg-play'),
                  live: el.querySelector('.rg-live'), slot: 0, index: 0, item: null,
                  src: '', hover: 0, hoverGoal: 0 };
        /* 池里的卡默认隐藏：只有被 layout() 更新到的可见 slot 才显示，
           否则未使用的池卡会叠在中心，露出空的 LIVE / 播放标记 */
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        c.play.style.display = 'none';
        c.live.style.display = 'none';
        (function (card) {
          listen(card.el, 'pointerenter', function () { card.hoverGoal = 1; wake(); });
          listen(card.el, 'pointerleave', function () { card.hoverGoal = 0; wake(); });
          listen(card.el, 'click', function (ev) {
            if (state.suppressClick) { state.suppressClick = false; return; }
            if (!card.item) return;
            ev.stopPropagation();
            if (s.onItemClick) s.onItemClick(card.item, card.index);
            openAt(card.slot, card.el);
          });
        })(c);
        belt.appendChild(el); cards.push(c);
      }
    }
    function applyMetrics() {
      cards.forEach(function (c) {
        c.el.style.width = met.w + 'px';
        c.el.style.height = met.h + 'px';
      });
    }

    /* ---------- 布局与绘制 ---------- */
    function layout() {
      var count = s.items.length;
      if (!count) return;
      var enter = clamp(state.frames / 30, 0, 1);
      var scroll = state.scroll;
      var first = Math.floor((scroll - view.w / 2 - met.spacing * 2) / met.spacing);
      var lastSlot = Math.ceil((scroll + view.w / 2 + met.spacing * 2) / met.spacing);
      cards.forEach(function (c0) {
        c0.el.style.opacity = '0';
        c0.el.style.pointerEvents = 'none';
      });
      for (var slot = first; slot <= lastSlot; slot++) {
        var c = cards[wrap(slot, cards.length)];
        var index = wrap(slot, count);
        var item = s.items[index];
        var x = slot * met.spacing - scroll;
        var arc = arcOf(x);
        var order = Math.abs(slot * met.spacing - state.scroll) / met.spacing;
        var shown = ease(clamp(2.2 - order * 0.22, 0, 1));
        var cx = view.w / 2 + x;
        var alpha = shown * edgeFade(cx / view.w);
        var lift = 1 + c.hover * 0.04;
        var yCss = -arc.y - (1 - enter) * met.h * 0.12;
        var rot = -arc.angle;

        c.slot = slot; c.index = index; c.item = item;
        if (c.src !== item.image) {
          c.src = item.image;
          c.img.src = item.image;
          c.img.alt = item.title || '';
        }
        c.play.style.display = item.type === 'video' ? '' : 'none';
        c.live.style.display = item.live ? '' : 'none';
        c.el.style.transform = 'translate(-50%,-50%) translate3d(' +
          x.toFixed(1) + 'px,' + yCss.toFixed(1) + 'px,0) rotate(' +
          rot.toFixed(4) + 'rad) scale(' + lift.toFixed(3) + ')';
        c.el.style.opacity = alpha.toFixed(3);
        c.el.style.zIndex = String(Math.round(1000 - Math.abs(x) / 8));
        c.el.style.pointerEvents = alpha > 0.08 ? 'auto' : 'none';
      }
    }

    /* ---------- 动画循环 ---------- */
    function nearest() { return Math.round(state.target / Math.max(state.spacing, 1)); }
    function setSlot(slot, announce) {
      state.target = slot * state.spacing;
      if (slot !== state.active) {
        state.active = slot;
        if (announce !== false && s.onActiveChange) {
          s.onActiveChange(wrap(slot, s.items.length));
        }
      }
      wake();
    }
    function wake() {
      if (!state.raf && !destroyed && !document.hidden) {
        state.raf = requestAnimationFrame(frame);
      }
    }
    function frame() {
      state.raf = 0;
      if (destroyed || document.hidden) return;
      /* 固定步长：rAF 时间戳在 headless 虚拟时间下可能不推进 */
      state.frames++;
      var dt = 1 / 60;
      var wall = Date.now();
      var count = s.items.length;

      var idle = wall - state.lastInput > 1800;
      var auto = s.autoScroll && !state.drag && !state.open &&
                 state.hovered === null && idle;
      if (auto) state.target += s.autoScroll * state.spacing * 0.25 * dt;

      var follow = 1 - Math.pow(1 - s.scrollEase, dt * 60);
      var before = state.scroll;
      state.scroll += (state.target - state.scroll) * follow;
      if (Math.abs(state.target - state.scroll) < 0.05) state.scroll = state.target;
      var velocity = (state.scroll - before) / dt;
      state.velocity += (velocity - state.velocity) * (1 - Math.exp(-dt / 0.08));
      if (Math.abs(state.velocity) < 0.5) state.velocity = 0;


      var settling = false;
      cards.forEach(function (c) {
        var next = c.hover + (c.hoverGoal - c.hover) * (1 - Math.exp(-dt / 0.12));
        if (Math.abs(c.hoverGoal - next) < 0.002) { c.hover = c.hoverGoal; }
        else { c.hover = next; settling = true; }
      });

      var slot = nearest();
      if (slot !== state.active && !state.drag) {
        state.active = slot;
        if (s.onActiveChange) s.onActiveChange(wrap(slot, count));
      }

      layout();

      var moving = (s.autoScroll && !state.drag && !state.open) ||
                   state.scroll !== state.target || state.velocity !== 0 ||
                   state.intro < 1 || settling;
      if (moving) state.raf = requestAnimationFrame(frame);
    }

    /* ---------- 尺寸 ---------- */
    function applyResize() {
      view.w = Math.max(1, host.clientWidth);
      view.h = Math.max(1, host.clientHeight);
      met = measure();
      var before = state.spacing;
      if (before > 1 && met.spacing !== before) {
        state.scroll = (state.scroll / before) * met.spacing;
        state.target = (state.target / before) * met.spacing;
      }
      state.spacing = met.spacing;
      ensurePool();
      applyMetrics();
      wake();
    }
    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(applyResize);
      ro.observe(host);
    } else {
      listen(window, 'resize', applyResize);
    }

    /* ---------- 拖拽 / 滚轮 / 键盘 ---------- */
    function snapNow() { if (s.snap) setSlot(nearest()); }
    listen(stage, 'pointerdown', function (e) {
      if (e.button !== 0) return;
      state.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY,
                     start: state.target, moved: false, samples: [] };
      state.lastInput = Date.now();
      wake();
    });
    listen(stage, 'pointermove', function (e) {
      var d = state.drag;
      if (!d || d.id !== e.pointerId) return;
      var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) > 6) {
        d.moved = true;
        if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (x) { } }
        stage.classList.add('dragging');
      }
      if (d.moved) {
        state.target = d.start - dx * (s.scrollSpeed / 2);
        d.samples.push({ x: e.clientX, t: Date.now() });
        if (d.samples.length > 6) d.samples.shift();
        state.lastInput = Date.now();
        wake();
      }
    });
    function endDrag(e) {
      var d = state.drag;
      if (!d || d.id !== e.pointerId) return;
      state.drag = null;
      stage.classList.remove('dragging');
      if (stage.hasPointerCapture && stage.hasPointerCapture(e.pointerId)) {
        try { stage.releasePointerCapture(e.pointerId); } catch (x) { }
      }
      if (d.moved) {
        state.suppressClick = true;
        setTimeout(function () { state.suppressClick = false; }, 60);
        if (d.samples.length > 1) {
          var a = d.samples[0], b = d.samples[d.samples.length - 1];
          var span = Math.max(b.t - a.t, 16);
          state.target -= ((b.x - a.x) / span) * 1000 * 0.18 * (s.scrollSpeed / 2);
        }
        snapNow();
      }
    }
    listen(stage, 'pointerup', endDrag);
    listen(stage, 'pointercancel', endDrag);
    listen(stage, 'wheel', function (e) {
      var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.h : 1;
      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      state.target += delta * unit * (s.scrollSpeed / 2);
      state.lastInput = Date.now();
      clearTimeout(state.snapTimer);
      state.snapTimer = setTimeout(snapNow, 140);
      wake();
    }, { passive: false });
    listen(stage, 'pointerenter', function () { state.hovered = 1; });
    listen(stage, 'pointerleave', function () { state.hovered = null; });
    listen(document, 'keydown', function (e) {
      if (destroyed || !host.isConnected) return;
      if (e.key === 'Escape' && state.open) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (state.open) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); openAt(state.openSlot - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); openAt(state.openSlot + 1); }
        return;
      }
      if (!host.contains(document.activeElement) && !host.matches(':hover')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setSlot(nearest() - 1); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setSlot(nearest() + 1); }
    });

    /* ---------- 放大层：全貌 / 视频播放 / 附加图 ---------- */
    function stopVideo() {
      var v = mediaBox.querySelector('video');
      if (v) { try { v.pause(); } catch (x) { } }
    }
    function setMedia(item, src) {
      stopVideo();
      mediaBox.innerHTML = '';
      if (item.type === 'video' && !src) {
        var v = document.createElement('video');
        v.controls = true; v.autoplay = true; v.playsInline = true;
        v.preload = 'metadata'; v.poster = item.image;
        v.src = item.full || item.image;
        mediaBox.appendChild(v);
        /* 点击卡片本身就是用户手势，显式调用一次播放更稳；
           若浏览器仍拦截自动播放，controls 可手动点 */
        var pr = v.play();
        if (pr && pr.catch) pr.catch(function () { });
      } else {
        var im = document.createElement('img');
        im.src = src || item.full || item.image;
        im.alt = item.title || '';
        mediaBox.appendChild(im);
      }
    }
    function buildAttach(item) {
      attachBox.innerHTML = '';
      var list = [{ src: item.image, label: '原图' }].concat(
        (item.attach || []).map(function (a) { return { src: a.src, label: a.label || '附图' }; })
      );
      if (list.length < 2) { attachBox.style.display = 'none'; return; }
      attachBox.style.display = '';
      list.forEach(function (a, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.i = String(i);
        b.className = 'rg-attach-thumb' + (i === state.attachIndex ? ' on' : '');
        b.innerHTML = '<img src="' + a.src + '" alt=""><span>' + a.label + '</span>';
        attachBox.appendChild(b);
      });
    }
    listen(attachBox, 'click', function (e) {
      var b = e.target.closest ? e.target.closest('.rg-attach-thumb') : null;
      if (!b || !state.viewerItem) return;
      var i = +b.dataset.i;
      state.attachIndex = i;
      var list = [{ src: state.viewerItem.image }].concat(state.viewerItem.attach || []);
      var a = list[i];
      setMedia(state.viewerItem, i === 0 ? (state.viewerItem.full || state.viewerItem.image) : a.src);
      Array.prototype.forEach.call(attachBox.children, function (n, k) {
        n.classList.toggle('on', k === i);
      });
    });
    function flip(fromEl) {
      if (!fromEl) return;
      var r0 = fromEl.getBoundingClientRect();
      var r1 = mediaBox.getBoundingClientRect();
      if (!r1.width || !r1.height) return;
      var sx = r0.width / r1.width, sy = r0.height / r1.height;
      var dx = (r0.left + r0.width / 2) - (r1.left + r1.width / 2);
      var dy = (r0.top + r0.height / 2) - (r1.top + r1.height / 2);
      mediaBox.style.transition = 'none';
      mediaBox.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
      requestAnimationFrame(function () {
        mediaBox.style.transition = '';
        mediaBox.style.transform = '';
      });
    }
    function openAt(slot, fromEl) {
      var count = s.items.length;
      if (!count) return;
      state.openSlot = slot;
      state.open = true;
      state.attachIndex = 0;
      state.lastInput = Date.now();
      var item = s.items[wrap(slot, count)];
      state.viewerItem = item;
      setSlot(slot);
      setMedia(item);
      buildAttach(item);
      vcount.textContent = pad(wrap(slot, count) + 1) + ' / ' + pad(count);
      viewer.hidden = false;
      host.classList.add('rg-open');
      if (fromEl) flip(fromEl);
      if (s.onOpen) s.onOpen(item, wrap(slot, count));
    }
    function close() {
      if (!state.open) return;
      stopVideo();
      state.open = false;
      host.classList.remove('rg-open');
      viewer.classList.add('closing');
      setTimeout(function () {
        if (destroyed) return;
        viewer.hidden = true;
        viewer.classList.remove('closing');
        mediaBox.innerHTML = '';
      }, 260);
      if (s.onClose) s.onClose();
      wake();
    }
    listen(closeBtn, 'click', close);
    listen(viewerBg, 'click', close);
    listen(prevBtn, 'click', function () { openAt(state.openSlot - 1); });
    listen(nextBtn, 'click', function () { openAt(state.openSlot + 1); });

    /* ---------- 公共 API ---------- */
    this.setItems = function (items) {
      s.items = items || [];
      state.scroll = 0; state.target = 0; state.active = 0;
      state.intro = 1; state.last = 0; state.frames = 0;
      state.open = false; host.classList.remove('rg-open');
      viewer.hidden = true; viewer.classList.remove('closing');
      mediaBox.innerHTML = '';
      cards.forEach(function (c) { c.src = ''; });
      if (s.onActiveChange) s.onActiveChange(0);
      applyResize();
    };
    this.step = function (dir) { setSlot(nearest() + dir); };
    this.open = function (index) { openAt(index); };
    this.close = close;
    this.activeIndex = function () { return wrap(state.active, s.items.length); };
    this.count = function () { return s.items.length; };
    this.destroy = function () {
      destroyed = true;
      cancelAnimationFrame(state.raf);
      clearTimeout(state.snapTimer);
      if (ro) ro.disconnect();
      listeners.forEach(function (off) { off(); });
      stopVideo();
      host.innerHTML = '';
      host.classList.remove('rg-root', 'rg-open');
    };

    applyResize();
  }

  window.CircularGallery = CircularGallery;
})();

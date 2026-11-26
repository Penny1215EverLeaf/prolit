/* ============================================================
   Portfolio app — vanilla JS, no build, works over file://
   Desk scene stays on screen; every entry opens an in-place
   overlay (blurred backdrop) instead of a full-screen view.
   Overlays: plans folders + draggable deck / circular gallery /
             carousel / resume / flip-book / lightbox
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = {
    spotlight: $('#spotlight'), hotzones: $('#hotzones'), mobileNav: $('#mobileNav'),
    home: $('#home'), view: $('#view'), viewBody: $('#viewBody'),
    backBtn: $('#backBtn'), lightbox: $('#lightbox'), toast: $('#toast'),
    brandName: $('#brandName'), brandRole: $('#brandRole')
  };

  var SITE = window.SITE || {};
  var HOT = window.HOTZONES || {};
  var PLANS = window.PLANS || [];
  var MEDIA = window.MEDIA || [];
  var OPS = window.OPS || [];

  /* React Bits Folder 分组：三个「策划案」文件夹 + 「舆情汇总」
     （名称统一，份数徽标区分；花少系列 4 份单独一档） */
  var PLAN_GROUPS = [
    { label: '策划案', slugs: ['plan02', 'plan03', 'plan04', 'plan05', 'plan06', 'plan08'] },
    { label: '策划案', slugs: ['plan12', 'plan13', 'plan14', 'plan25'] },
    { label: '策划案', slugs: ['plan10', 'plan11', 'plan26', 'plan27'] },
    { label: '舆情汇总', slugs: ['plan18', 'plan23'] }
  ];

  var cleanups = [];
  var bookCleanup = null;
  var currentView = 'home';
  var toastTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }
  function clearView() {
    cleanups.forEach(function (fn) { try { fn(); } catch (e) { } });
    cleanups = [];
    if (bookCleanup) { try { bookCleanup(); } catch (e) { } bookCleanup = null; }
    closeLightbox();
    el.viewBody.innerHTML = '';
  }
  function onKey(fn) {
    var h = function (e) { fn(e); };
    window.addEventListener('keydown', h);
    cleanups.push(function () { window.removeEventListener('keydown', h); });
  }
  /* 全局快捷键不随视图清理注销 */
  function onGlobalKey(fn) {
    window.addEventListener('keydown', function (e) { fn(e); });
  }

  /* ----------------------------------------------------------
     Desk scene
     ---------------------------------------------------------- */
  function buildScene() {
    if (SITE.name) el.brandName.textContent = SITE.name;
    if (SITE.role) el.brandRole.textContent = SITE.role;

    var order = ['wall', 'badge', 'computer', 'frames', 'folders'];
    order.forEach(function (key) {
      var d = HOT[key]; if (!d) return;
      var hz = document.createElement('div');
      hz.className = 'hotzone';
      hz.tabIndex = 0;
      hz.setAttribute('role', 'button');
      hz.setAttribute('aria-label', d.label + ' · 点击查看');
      hz.style.cssText = '--l:' + d.l + '%;--t:' + d.t + '%;--w:' + d.w + '%;--h:' + d.h +
        '%;--lx:' + (d.lx || '50%') + ';--ly:' + (d.ly || '-3.4em');
      hz.style.animation = 'fadeIn .7s ' + (0.15 + order.indexOf(key) * 0.11) + 's ease both';
      hz.innerHTML =
        '<div class="hz-visual">' +
          '<img class="hz-glow" src="' + d.glow + '" alt="">' +
          '<img class="hz-img" src="' + d.img + '" alt="">' +
        '</div>' +
        '<div class="hz-label"><span class="num">' + d.num + '</span>' + esc(d.label) + '</div>';
      var go = function () { showView(d.target, d.arg); };
      hz.addEventListener('click', go);
      hz.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
      el.hotzones.appendChild(hz);
    });

    // mobile fallback list
    var mobileOrder = ['folders', 'frames', 'computer', 'wall', 'badge'];
    mobileOrder.forEach(function (key, i) {
      var d = HOT[key]; if (!d) return;
      var a = document.createElement('button');
      a.type = 'button';
      a.className = 'm-card' + (i === 4 ? ' wide' : '');
      a.innerHTML = '<img src="' + d.img + '" alt=""><b>' + esc(d.label) + '</b><span>' + esc(d.num) + ' / ' + esc(d.en) + '</span>';
      a.addEventListener('click', function () { showView(d.target, d.arg); });
      el.mobileNav.appendChild(a);
    });
  }

  /* cursor spotlight — 200px radius, 16% peak; disabled on touch */
  function buildSpotlight() {
    var coarse = window.matchMedia('(pointer: coarse)').matches ||
                 !window.matchMedia('(hover: hover)').matches;
    if (coarse) { el.spotlight.style.display = 'none'; return; }
    window.addEventListener('pointermove', function (e) {
      el.spotlight.style.setProperty('--mx', e.clientX + 'px');
      el.spotlight.style.setProperty('--my', e.clientY + 'px');
    }, { passive: true });
  }

  /* ----------------------------------------------------------
     Overlay routing — opens in place, photo blurred behind
     ---------------------------------------------------------- */
  function showView(name, arg) {
    clearView();
    currentView = name;
    el.view.hidden = false;
    document.body.classList.add('view-open');

    if (name === 'plans') renderPlans();
    else if (name === 'media') renderMedia(arg || 'video');
    else if (name === 'ops') renderOps();
    else if (name === 'resume') renderResume();
  }
  function closeOverlay() {
    clearView();
    currentView = 'home';
    el.view.hidden = true;
    document.body.classList.remove('view-open');
  }
  el.backBtn.addEventListener('click', closeOverlay);

  onGlobalKey(function (e) {
    if (e.key === 'Escape') {
      if (!el.lightbox.hidden) closeLightbox();
      else if (document.querySelector('.rg-root.rg-open')) return; /* 画廊放大层自行关闭 */
      else if (document.querySelector('.st-root')) { var sb = $('#stBack'); if (sb) sb.click(); } /* 故事播放先退回板块 */
      else if (currentView === 'book') { var b = $('#bookBack'); if (b) b.click(); }
      else if (currentView !== 'home') closeOverlay();
    }
  });

  /* ==========================================================
     1. PLANS — four orange folders (React Bits "Folder")
        Click a folder → the others fade out, the folder sinks
        to the bottom → its documents spread out above it one by
        one (panel layout, never stacked). Cards stay draggable;
        click a card to zoom into its flip-book. Outside click
        collapses / closes.
     ========================================================== */
  function splitGroups() {
    return PLAN_GROUPS.map(function (g) {
      var plans = PLANS.filter(function (p) {
        if (g.slugs) return g.slugs.indexOf(p.slug) !== -1;
        return !PLAN_GROUPS.some(function (o) {
          return o.slugs && o.slugs.indexOf(p.slug) !== -1;
        });
      });
      return { label: g.label, plans: plans };
    });
  }

  function renderPlans() {
    clearView(); currentView = 'plans';
    var groups = splitGroups();
    var total = PLANS.length;

    el.viewBody.innerHTML =
      '<div class="pl-stage" id="plStage">' +
        '<div class="pl-folders" id="plFolders"></div>' +
        '<div class="pl-deck" id="plDeck"></div>' +
        '<button class="pl-reset" id="plReset" type="button">收起文件 ↩</button>' +
        '<div class="pl-hint" id="plHint">点击文件夹展开 · 共 <b>' + total + '</b> 份策划案</div>' +
      '</div>';

    var stage = $('#plStage'), foldersBox = $('#plFolders'), deck = $('#plDeck'),
        hint = $('#plHint'), resetBtn = $('#plReset');
    var folderEls = [];
    var openIdx = -1;
    var cards = [];
    var zTop = 40;

    groups.forEach(function (g, i) {
      var f = document.createElement('div');
      f.className = 'pfolder';
      f.tabIndex = 0;
      f.setAttribute('role', 'button');
      f.setAttribute('aria-label', '打开文件夹：' + g.label + '（' + (i + 1) + '，' + g.plans.length + ' 份）');
      f.innerHTML =
        '<div class="pf-back"><div class="pf-emboss"><b>' + String(g.plans.length).padStart(2, '0') + '</b><span>DOCUMENTS</span></div></div>' +
        '<div class="pf-sheets"><i></i><i></i><i></i></div>' +
        '<div class="pf-front"><span class="pf-label">' + esc(g.label) + '</span>' +
        '<span class="pf-count">' + g.plans.length + ' FILES</span></div>';
      var openIt = function () { if (openIdx !== i) openFolder(i); };
      f.addEventListener('click', openIt);
      f.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); }
      });
      foldersBox.appendChild(f);
      folderEls.push(f);
    });

    function cardSize() {
      var small = window.innerWidth < 760;
      return { w: small ? 112 : 148, h: small ? 150 : 196 };
    }
    /* 展开后：文件夹沉底，文件在上方面板式逐张排开（不叠放） */
    function gridLayout(n, CS) {
      var r = stage.getBoundingClientRect();
      var small = r.width < 760;
      var gap = small ? 12 : 28;
      var cols = small ? Math.min(n, 2) : (n <= 4 ? n : 3);
      var rows = Math.ceil(n / cols);
      var gw = cols * CS.w + (cols - 1) * gap;
      var gh = rows * CS.h + (rows - 1) * gap;
      var cx = r.width / 2;
      /* 上下留白：顶不贴边、底不压住沉到 76~79% 处的文件夹 */
      var cy = Math.max(gh / 2 + 16, r.height * (small ? 0.36 : 0.34));
      cy = Math.min(cy, r.height * 0.70 - gh / 2);
      var x0 = cx - gw / 2 + CS.w / 2;
      var y0 = cy - gh / 2 + CS.h / 2;
      var pos = [];
      for (var j = 0; j < n; j++) {
        var col = j % cols, row = Math.floor(j / cols);
        pos.push({
          dx: Math.round(x0 + col * (CS.w + gap) - cx),
          dy: Math.round(y0 + row * (CS.h + gap) - cy)
        });
      }
      return { pos: pos, cx: cx, cy: cy };
    }
    function clearDeck() {
      deck.innerHTML = ''; cards = [];
    }
    function collapse() {
      if (openIdx !== -1) folderEls[openIdx].classList.remove('open');
      folderEls.forEach(function (fe) { fe.classList.remove('gone'); fe.style.left = ''; fe.style.top = ''; });
      foldersBox.classList.remove('solo');
      clearDeck();
      stage.classList.remove('deck-open');
      openIdx = -1;
      hint.innerHTML = '点击文件夹展开 · 共 <b>' + total + '</b> 份策划案';
    }
    resetBtn.addEventListener('click', collapse);
    /* closeOnOutsideClick：点空白处先收起文件夹，再点一次关闭浮层 */
    stage.addEventListener('click', function (e) {
      if (e.target !== stage) return;
      if (openIdx !== -1) collapse(); else closeOverlay();
    });

    function openFolder(i) {
      if (openIdx === i) return;
      if (openIdx !== -1) folderEls[openIdx].classList.remove('open');
      clearDeck();
      openIdx = i;
      folderEls[i].classList.add('open');
      /* 其余文件夹原位淡出并脱离布局流，被点中的沉到底部且水平居中 */
      foldersBox.classList.add('solo');
      folderEls.forEach(function (fe, k) {
        if (k === i) return;
        fe.style.left = fe.offsetLeft + 'px';
        fe.style.top = fe.offsetTop + 'px';
        fe.classList.add('gone');
      });
      stage.classList.add('deck-open');
      hint.innerHTML = '拖动文件可自由摆放 · 点击文件翻阅内容';
      var g = groups[i];
      var CS = cardSize();
      var L = gridLayout(g.plans.length, CS);

      g.plans.forEach(function (p, j) {
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'doc-card' + (p.wide ? ' wide' : '');
        c.setAttribute('aria-label', '打开策划案第 ' + (j + 1) + ' 份');
        c.innerHTML = '<img src="' + p.cover + '" alt=""><span class="dc-pages">' + p.pages.length + 'P</span>';
        var pos = L.pos[j];
        var st = { el: c, plan: p, rot: 0, dx: pos.dx, dy: pos.dy };
        deck.appendChild(c); cards.push(st);

        var lx = Math.max(8, Math.min(stage.clientWidth - CS.w - 8, L.cx - CS.w / 2));
        var ly = Math.max(8, Math.min(stage.clientHeight - CS.h - 8, L.cy - CS.h / 2));
        c.style.left = lx + 'px';
        c.style.top = ly + 'px';
        c.style.transform = 'translate(0,26px) scale(.86) rotate(0deg)';
        c.style.opacity = '0';
        c.style.zIndex = String(40 + j);

        setTimeout(function () {
          var dl = Math.min(j * 55, 480);
          c.style.transitionDelay = dl + 'ms';
          c.style.opacity = '1';
          c.style.transform = 'translate(' + pos.dx + 'px,' + pos.dy + 'px) scale(1) rotate(0deg)';
          setTimeout(function () { c.style.transitionDelay = '0ms'; }, dl + 650);
        }, 360);

        attachDrag(st, CS.w, CS.h);
      });
    }

    function attachDrag(st, CW, CH) {
      var c = st.el, down = false, moved = 0, sx = 0, sy = 0, ox = 0, oy = 0;
      c.addEventListener('pointerdown', function (e) {
        down = true; moved = 0;
        sx = e.clientX; sy = e.clientY;
        ox = parseFloat(c.style.left) + CW / 2 + st.dx;
        oy = parseFloat(c.style.top) + CH / 2 + st.dy;
        c.classList.add('dragging');
        /* 把扇形偏移并入坐标，之后卡片严格跟手 */
        c.style.transform = 'translate(0,0) scale(1) rotate(' + st.rot + 'deg)';
        c.style.left = (ox - CW / 2) + 'px';
        c.style.top = (oy - CH / 2) + 'px';
        st.dx = 0; st.dy = 0;
        c.style.zIndex = String(++zTop);
        try { c.setPointerCapture(e.pointerId); } catch (x) { }
        e.preventDefault();
      });
      c.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        st.x = ox + dx; st.y = oy + dy;
        c.style.left = (st.x - CW / 2) + 'px';
        c.style.top = (st.y - CH / 2) + 'px';
      });
      function up() {
        if (!down) return;
        down = false;
        c.classList.remove('dragging');
        if (moved < 7) { openBook(st.plan, stage); return; }
        /* 自由拖动：松手后停在原地 */
        c.style.transform = 'translate(0,0) scale(1) rotate(' + st.rot + 'deg)';
      }
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    }

    /* debug deep-link: ?open=plans&folder=0|1|2|3  (+ &doc=0 直接开翻页书) */
    try {
      var fi = new URLSearchParams(location.search).get('folder');
      var di = new URLSearchParams(location.search).get('doc');
      if (fi !== null && !isNaN(+fi)) setTimeout(function () { openFolder(+fi); }, 480);
      if (di !== null && !isNaN(+di)) {
        setTimeout(function () {
          var all = [];
          groups.forEach(function (g) { all = all.concat(g.plans); });
          if (all[+di]) openBook(all[+di], stage);
        }, 1000);
      }
    } catch (e) { }
  }

  /* ---------- flip-book for one plan (zoom-on-click) ---------- */
  function openBook(plan, stageEl) {
    if (bookCleanup) { try { bookCleanup(); } catch (e) { } bookCleanup = null; }
    if (stageEl) stageEl.style.display = 'none';
    var old = $('#bookView'); if (old) old.remove();
    currentView = 'book';

    var holder = document.createElement('div');
    holder.className = 'book-view' + (plan.wide ? ' wide-book' : '');
    holder.id = 'bookView';
    holder.innerHTML =
      '<div class="book-bar">' +
        '<button class="book-back" id="bookBack" type="button">← 返回文件夹</button>' +
        '<span class="bb-page" id="bbPage"></span>' +
      '</div>' +
      '<div class="book-stage" id="bookStage"></div>' +
      '<div class="book-nav">' +
        '<button id="bPrev" type="button" aria-label="上一页">←</button>' +
        '<div class="book-dots" id="bDots"></div>' +
        '<button id="bNext" type="button" aria-label="下一页">→</button>' +
      '</div>' +
      '<div class="panel-note">用 ← → 或滑动翻页</div>';
    el.viewBody.appendChild(holder);

    var stage = $('#bookStage'), dots = $('#bDots'), pageLabel = $('#bbPage');
    var cur = 0, animating = false, current = null;

    function pageEl(i) {
      var d = document.createElement('div');
      d.className = 'doc-page';
      d.innerHTML = '<div class="doc-inner">' + (plan.pages[i] || '<p class="doc-empty">（空白页）</p>') + '</div>';
      return d;
    }
    function update() {
      pageLabel.innerHTML = '<b>' + String(cur + 1).padStart(2, '0') + '</b> / ' + String(plan.pages.length).padStart(2, '0');
      $('#bPrev').disabled = cur === 0;
      $('#bNext').disabled = cur === plan.pages.length - 1;
      Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === cur); });
    }
    function render() {
      stage.innerHTML = '';
      current = pageEl(cur); stage.appendChild(current); update();
    }
    function go(to, dir) {
      if (animating || to < 0 || to >= plan.pages.length || to === cur) return;
      animating = true;
      var incoming = pageEl(to);
      incoming.style.zIndex = 2;
      stage.appendChild(incoming);
      current.classList.add(dir === 1 ? 'flip-out-next' : 'flip-out-prev');
      incoming.classList.add(dir === 1 ? 'flip-in-next' : 'flip-in-prev');
      setTimeout(function () {
        stage.innerHTML = '';
        current = incoming;
        current.classList.remove('flip-in-next', 'flip-in-prev');
        current.style.zIndex = '';
        stage.appendChild(current);
        animating = false;
      }, 430);
      cur = to; update();
    }
    plan.pages.forEach(function (_, i) {
      var dot = document.createElement('i');
      dot.title = '第 ' + (i + 1) + ' 页';
      dot.addEventListener('click', function () { go(i, i > cur ? 1 : -1); });
      dots.appendChild(dot);
    });
    $('#bPrev').addEventListener('click', function () { go(cur - 1, -1); });
    $('#bNext').addEventListener('click', function () { go(cur + 1, 1); });

    function backToStage() {
      if (bookCleanup) { try { bookCleanup(); } catch (e) { } bookCleanup = null; }
      var bv = $('#bookView'); if (bv) bv.remove();
      currentView = 'plans';
      if (stageEl) stageEl.style.display = '';
    }
    $('#bookBack').addEventListener('click', backToStage);

    var onArrows = function (e) {
      if (currentView !== 'book') return;
      if (e.key === 'ArrowLeft') go(cur - 1, -1);
      if (e.key === 'ArrowRight') go(cur + 1, 1);
    };
    window.addEventListener('keydown', onArrows);
    var sx = null;
    stage.addEventListener('touchstart', function (e) { sx = e.changedTouches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 55) go(cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }, { passive: true });

    bookCleanup = function () {
      window.removeEventListener('keydown', onArrows);
    };
    render();
  }

  /* ==========================================================
     2. CIRCULAR GALLERY (React Bits 动效复刻)
        视频物料 / 图片物料共用一条圆弧画廊；点击卡片放大成全貌，
        视频就地播放；主图的 prompt 截图作为附加图，不单独占卡片。
     ========================================================== */
  function renderMedia(defaultTab) {
    var tab = defaultTab || 'video';
    el.viewBody.innerHTML =
      '<div class="cv-view">' +
        '<div class="cv-stage" id="cvStage"></div>' +
        '<div class="cv-tabs" id="cvTabs">' +
          '<button data-t="video" type="button">视频物料</button>' +
          '<button data-t="image" type="button">图片物料</button>' +
          '<button data-t="all" type="button">全部</button>' +
        '</div>' +
        '<div class="cv-hud">' +
          '<button id="cvPrev" type="button" aria-label="上一项">←</button>' +
          '<span class="cv-count" id="cvCount"></span>' +
          '<button id="cvNext" type="button" aria-label="下一项">→</button>' +
        '</div>' +
        '<div class="cv-note">拖动 / 滚轮浏览 · 点击放大全貌或播放</div>' +
      '</div>';

    var stage = $('#cvStage'), tabs = $('#cvTabs'), countEl = $('#cvCount');

    /* 展示规则：
       - prompt 截图（hidden）不单独成卡，放大主图时在下方附加展示
       - 两个 live 图（原本是 mp4）归入图片物料，不放视频物料
       - 视频物料只放真正的视频作品 */
    function itemsFor(t) {
      return MEDIA.filter(function (m) {
        if (m.hidden) return false;
        if (t === 'all') return true;
        if (t === 'image') return m.type === 'image' || m.live;
        return m.type === 'video' && !m.live;
      }).map(function (m) {
        return {
          image: m.cover, full: m.src, type: m.type,
          live: !!m.live, attach: m.attach || [], title: m.title
        };
      });
    }
    function syncCount(i, n) {
      countEl.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
    }
    function syncTabs() {
      Array.prototype.forEach.call(tabs.children, function (b) {
        b.classList.toggle('on', b.dataset.t === tab);
      });
    }

    var gallery = new window.CircularGallery(stage, {
      items: itemsFor(tab),
      onActiveChange: function (i) { syncCount(i, gallery.count()); }
    });
    syncCount(0, gallery.count());
    syncTabs();

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.dataset.t === tab) return;
      tab = b.dataset.t;
      gallery.setItems(itemsFor(tab));
      syncCount(0, gallery.count());
      syncTabs();
    });
    $('#cvPrev').addEventListener('click', function () { gallery.step(-1); });
    $('#cvNext').addEventListener('click', function () { gallery.step(1); });

    /* debug deep-link: ?open=media&tab=image&item=N */
    try {
      var q = new URLSearchParams(location.search);
      var tq = q.get('tab');
      if (tq && tq !== tab) {
        tab = tq; gallery.setItems(itemsFor(tab));
        syncTabs(); syncCount(0, gallery.count());
      }
      var iq = q.get('item');
      if (iq !== null && !isNaN(+iq)) setTimeout(function () { gallery.open(+iq); }, 700);
    } catch (e) { }

    cleanups.push(function () { gallery.destroy(); });
  }

  /* ==========================================================
     3. OPS — Scroll Stack + Story Player (vanilla replica)
        Four boards stacked; scroll / drag to cycle; click a
        board to play its items as tap-through stories with
        segmented progress.
        OPS_GROUPS idx = 编号 01-14 对应 OPS 下标
        03-06 自媒体运营(后三张拼成一张) · 14/13/01/02 官微 · 11/12 官微 · 08-10 官微
        slides 覆盖默认逐张播放；每项 cap 为压在图片内的文字（封面文字补充也进图）
     ========================================================== */
  var OPS_GROUPS = [
    { title: '自媒体运营', label: '自媒体账号运营情况', idx: [2],
      cover: 'assets/thumbs/ops/ops_4_5_6.png', coverWide: true,
      slides: [
        { src: 'assets/thumbs/ops/3.png', cap: '自媒体账号运营情况' },
        { src: 'assets/thumbs/ops/ops_4_5_6.png',
          cap: '多个视频获得数十万点赞，且粉丝画像为18-21岁一线城市女性',
          sub: '自媒体账号运营情况' }
      ] },
    { title: '官微运营', label: '自主独立策划+文案撰写+制作图片物料多次收获万赞', idx: [13, 12, 0, 1] },
    { title: '官微运营', label: '独立制图+文案撰写多次获得万赞', idx: [10, 11] },
    { title: '官微运营', label: '独立文案撰写', idx: [7, 8, 9] }
  ];
  function slidesOf(g) {
    if (g.slides) return g.slides;
    return g.idx.map(function (i) { return { src: (OPS[i] || {}).src || '', cap: g.label }; });
  }

  function renderOps() {
    el.viewBody.innerHTML =
      '<div class="sk-view">' +
        '<div class="sk-stage" id="skStage"></div>' +
        '<div class="sk-nav">' +
          '<button class="sk-arrow" id="skUp" type="button" aria-label="上翻一个板块">↑<em>上翻</em></button>' +
          '<button class="sk-arrow" id="skDown" type="button" aria-label="下翻一个板块">↓<em>下翻</em></button>' +
        '</div>' +
        '<div class="sk-foot"><span class="sk-count" id="skCount"></span>' +
        '<div class="sk-hint">点箭头 / 滚动 / 上下拖动换板块 · 点击板块进入</div>' +
        '<span class="sk-count sk-count-r" id="skTotal"></span></div>' +
      '</div>';

    var stage = $('#skStage');
    var cards = [], active = 0;
    var groups = OPS_GROUPS.filter(function (g) { return g.idx.length; });
    var n = groups.length || 1;

    if (!OPS.length) {
      stage.innerHTML = '<p style="color:var(--ink-faint)">暂无运营情况图片</p>';
      return;
    }

    groups.forEach(function (g, i) {
      var ss = slidesOf(g);
      var cover = g.cover || ss[0].src;
      var c = document.createElement('div');
      c.className = 'sk-card';
      c.innerHTML =
        '<img class="sk-cover' + (g.coverWide ? ' sk-cover-fit' : '') + '" src="' + cover + '" alt="' + esc(g.title) + '">' +
        '<div class="sk-shade"></div>' +
        '<div class="sk-card-body">' +
          '<span class="sk-tag">' + String(ss.length).padStart(2, '0') + ' 张</span>' +
          '<h3>' + esc(g.title) + '</h3>' +
          '<p>' + esc(g.label) + '</p>' +
        '</div>' +
        '<span class="sk-num">' + String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0') + '</span>';
      c.addEventListener('click', function () {
        if (i === active) openStory(g);
        else { active = i; paint(); }
      });
      stage.appendChild(c); cards.push(c);
    });

    $('#skTotal').textContent = String(n).padStart(2, '0') + ' 板块';

    function paint() {
      cards.forEach(function (c, i) {
        var d = i - active;
        var y, s, o, z;
        if (d < 0) { /* 向上飞走 */
          var a = -d;
          y = -95 * Math.min(a, 1) - Math.max(0, a - 1) * 15;
          s = 1 + Math.min(a, 1) * .04;
          o = Math.max(0, 1 - a * 1.1);
          z = 40 - Math.round(a * 10);
        } else { /* 压在下面，d=0 为当前板块 */
          y = Math.min(d, 2.4) * 9; s = 1 - Math.min(d, 2.4) * .075;
          o = 1 - Math.min(d, 2.4) * .27; z = 40 - Math.round(d * 10);
        }
        c.style.transform = 'translate(-50%,-50%) translateY(' + y + '%) scale(' + s + ')';
        c.style.opacity = o;
        c.style.zIndex = z;
        c.style.pointerEvents = (d === 0) ? 'auto' : 'none';
        c.classList.toggle('sk-top', d === 0);
      });
      $('#skCount').textContent = String(active + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
      var up = $('#skUp'), down = $('#skDown');
      if (up) up.disabled = active <= 0;
      if (down) down.disabled = active >= n - 1;
    }
    function go(i) { active = Math.min(n - 1, Math.max(0, i)); paint(); }

    $('#skUp').addEventListener('click', function (e) { e.stopPropagation(); go(active - 1); });
    $('#skDown').addEventListener('click', function (e) { e.stopPropagation(); go(active + 1); });

    /* wheel — scroll stack 驱动 */
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      go(active + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    /* 上下拖动 */
    var sy = null;
    stage.addEventListener('pointerdown', function (e) { sy = e.clientY; });
    stage.addEventListener('pointerup', function (e) {
      if (sy == null) return;
      var dy = e.clientY - sy; sy = null;
      if (Math.abs(dy) > 40) go(active + (dy < 0 ? 1 : -1));
    });

    onKey(function (e) {
      if (currentView !== 'ops' || document.querySelector('.st-root')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(active + 1);
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(active - 1);
    });

    paint();

    /* ---------- Story Player ---------- */
    var storyTimer = 0, storyStep = null, AUTO = 4600;
    onKey(function (e) {
      if (!document.querySelector('.st-root') || !storyStep) return;
      if (e.key === 'ArrowRight') storyStep(1);
      if (e.key === 'ArrowLeft') storyStep(-1);
    });
    function openStory(g) {
      closeStory();
      var ss = slidesOf(g);
      var root = document.createElement('div');
      root.className = 'st-root';
      var segs = ss.map(function () { return '<span class="st-seg"><i></i></span>'; }).join('');
      root.innerHTML =
        '<button class="st-back" id="stBack" type="button">↩ 返回</button>' +
        '<div class="st-segs">' + segs + '</div>' +
        '<div class="st-media" id="stMedia"></div>' +
        '<button class="st-tap prev" id="stPrev" aria-label="上一张"></button>' +
        '<button class="st-tap next" id="stNext" aria-label="下一张"></button>' +
        '<button class="st-arrow st-arrow-prev" id="stArrowPrev" type="button" aria-label="上一张">‹</button>' +
        '<button class="st-arrow st-arrow-next" id="stArrowNext" type="button" aria-label="下一张">›</button>' +
        '<div class="st-foot"><b>' + esc(g.title) + '</b><em id="stIdx"></em></div>';
      el.viewBody.appendChild(root);

      var si = 0;
      var fills = root.querySelectorAll('.st-seg i');
      function paintStory() {
        var m = $('#stMedia');
        var s = ss[si];
        m.innerHTML =
          '<div class="st-figure">' +
            '<img src="' + s.src + '" alt="' + esc(g.title) + '">' +
          '</div>' +
          '<div class="st-cap">' +
            (s.sub ? '<small>' + esc(s.sub) + '</small>' : '') +
            '<span>' + esc(s.cap) + '</span>' +
          '</div>';
        var im = m.querySelector('img');
        im.style.transform = 'scale(.97)';
        setTimeout(function () { im.style.transform = 'none'; }, 20);
        fills.forEach(function (f, k) {
          f.style.transition = 'none';
          f.style.width = k < si ? '100%' : '0';
        });
        if (si < fills.length) {
          var f = fills[si];
          void f.offsetWidth;
          f.style.transition = 'width ' + AUTO + 'ms linear';
          f.style.width = '100%';
        }
        $('#stIdx').textContent = String(si + 1).padStart(2, '0') + ' / ' + String(ss.length).padStart(2, '0');
        $('#stArrowPrev').disabled = si <= 0;
        $('#stArrowNext').disabled = si >= ss.length - 1;
        arm();
      }
      function arm() {
        clearTimeout(storyTimer);
        if (si < ss.length - 1) storyTimer = setTimeout(function () { si++; paintStory(); }, AUTO);
      }
      function step(d) {
        si = Math.min(ss.length - 1, Math.max(0, si + d));
        paintStory();
      }
      $('#stPrev').addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
      $('#stNext').addEventListener('click', function (e) { e.stopPropagation(); step(1); });
      $('#stArrowPrev').addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
      $('#stArrowNext').addEventListener('click', function (e) { e.stopPropagation(); step(1); });
      $('#stBack').addEventListener('click', function (e) { e.stopPropagation(); closeStory(); });
      storyStep = step;
      paintStory();
    }
    function closeStory() {
      clearTimeout(storyTimer);
      storyStep = null;
      var old = document.querySelector('.st-root');
      if (old) old.remove();
    }
    cleanups.push(closeStory);
  }

  /* ==========================================================
     4. RESUME — just the resume + download PDF
     ========================================================== */
  function renderResume() {
    var imgs = SITE.resumeImages || [];
    var pages = imgs.length
      ? imgs.map(function (s) { return '<img src="' + s + '" alt="个人简历">'; }).join('')
      : '<p class="rs-empty">简历图片缺失</p>';
    el.viewBody.innerHTML =
      '<div class="rs-view">' +
        '<div class="rs-page-img">' + pages + '</div>' +
        '<a class="rs-dl" href="' + (SITE.pdf || '') + '" download>下载 PDF ↓</a>' +
      '</div>';
  }

  /* ==========================================================
     LIGHTBOX
     ========================================================== */
  var lbItems = [], lbIndex = 0;
  function openLightbox(items, index) {
    lbItems = items; lbIndex = index;
    paintLightbox();
  }
  function paintLightbox() {
    var m = lbItems[lbIndex]; if (!m) return;
    var media = m.type === 'video'
      ? '<video id="lbVideo" controls autoplay playsinline preload="metadata" src="' + m.src + '"></video>'
      : '<img src="' + (m.src || m.cover) + '" alt="' + esc(m.title) + '">';
    el.lightbox.innerHTML =
      '<div class="lb-inner">' +
        '<button class="lb-close" id="lbClose" type="button" aria-label="关闭">✕</button>' +
        (lbItems.length > 1 ? '<button class="lb-nav prev" id="lbPrev" type="button">←</button><button class="lb-nav next" id="lbNext" type="button">→</button>' : '') +
        media +
        '<div class="lb-title">' + String(lbIndex + 1).padStart(2, '0') + ' / ' + String(lbItems.length).padStart(2, '0') + (m.note ? ' &nbsp;·&nbsp; ' + esc(m.note) : '') + '</div>' +
      '</div>';
    el.lightbox.hidden = false;
    $('#lbClose').addEventListener('click', closeLightbox);
    el.lightbox.addEventListener('click', function (e) { if (e.target === el.lightbox) closeLightbox(); });
    if ($('#lbPrev')) $('#lbPrev').addEventListener('click', function (e) { e.stopPropagation(); lbStep(-1); });
    if ($('#lbNext')) $('#lbNext').addEventListener('click', function (e) { e.stopPropagation(); lbStep(1); });
    if (m.type === 'video' && !m.src) toast('该视频原片较大，完整版可向我索取');
  }
  function lbStep(d) { lbIndex = ((lbIndex + d) % lbItems.length + lbItems.length) % lbItems.length; paintLightbox(); }
  function closeLightbox() {
    if (el.lightbox.hidden) return;
    var v = $('#lbVideo'); if (v) { try { v.pause(); } catch (e) { } }
    el.lightbox.hidden = true; el.lightbox.innerHTML = '';
  }
  onGlobalKey(function (e) {
    if (el.lightbox.hidden) return;
    if (e.key === 'ArrowLeft') lbStep(-1);
    if (e.key === 'ArrowRight') lbStep(1);
  });

  /* ---------------------------------------------------------- */
  buildScene();
  buildSpotlight();

  /* ---------- BGM：进入网页自动循环播放，左上角按钮切换 ---------- */
  (function initBGM() {
    var audio = document.getElementById('bgm');
    var btn = document.getElementById('bgmToggle');
    if (!audio || !btn) return;
    audio.volume = 0.38;
    function syncBtn() {
      var playing = !audio.paused && !audio.ended;
      btn.classList.toggle('is-playing', playing);
      btn.setAttribute('aria-label', playing ? '暂停背景音乐' : '播放背景音乐');
    }
    function tryPlay() { var p = audio.play(); if (p && p.catch) p.catch(function () { }); }
    function onFirst(e) {
      if (btn.contains(e.target)) return; /* 点在按钮上，交给 click 自己决定，兜底不插手 */
      if (audio.paused) tryPlay();
      document.removeEventListener('pointerdown', onFirst);
    }
    function stopKick() { document.removeEventListener('pointerdown', onFirst); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      stopKick(); /* 用户已主动接管，撤掉首次交互兜底，避免之后又被强制拉起 */
      if (audio.paused) tryPlay(); else audio.pause();
      setTimeout(syncBtn, 60);
    });
    audio.addEventListener('play', syncBtn);
    audio.addEventListener('pause', syncBtn);
    /* 播放视频时自动停 BGM；视频全部停止后自动恢复（仅限被视频打断的情况） */
    function anyVideoPlaying() {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        if (!vs[i].paused && !vs[i].ended) return true;
      }
      return false;
    }
    var pausedByVideo = false;
    document.addEventListener('play', function (e) {
      if (!e.target || e.target.tagName !== 'VIDEO') return;
      if (!audio.paused) { pausedByVideo = true; audio.pause(); }
    }, true);
    function maybeResume() {
      if (pausedByVideo && !anyVideoPlaying()) {
        pausedByVideo = false;
        tryPlay();
      }
    }
    document.addEventListener('pause', function (e) {
      if (e.target && e.target.tagName === 'VIDEO') setTimeout(maybeResume, 0);
    }, true);
    document.addEventListener('ended', function (e) {
      if (e.target && e.target.tagName === 'VIDEO') setTimeout(maybeResume, 0);
    }, true);
    /* 自动播放：直接尝试；被浏览器策略拦截则等首次交互再起 */
    tryPlay();
    document.addEventListener('pointerdown', onFirst);
    setTimeout(syncBtn, 200);
  })();

  /* debug / deep-link: ?open=plans|media|ops|resume （媒体视图可带 &tab=&item=） */
  try {
    var q = new URLSearchParams(location.search).get('open');
    if (q) showView(q);
  } catch (e) { }
})();

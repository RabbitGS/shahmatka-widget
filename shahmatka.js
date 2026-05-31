/* ============================================================
 * Шахматка — виджет выбора квартир для застройщика.
 * Экраны:
 *   1) Генплан — рендер ЖК с кликабельными пинами этапов/домов.
 *   2) Выбор — фильтры + карточки планировок (вкладка) + шахматка (вкладка).
 * Без зависимостей. Данные — статичный JSON (см. data.json).
 *
 *   Shahmatka.init({ container:'#shahmatka', dataUrl:'data.json', onLead: function(flat){...} });
 * ============================================================ */
(function (global) {
  'use strict';

  var money = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
  var roomsLabel = function (r) { return r === 0 ? 'Студия' : r + '-комн.'; };
  var roomsShort = function (r) { return r === 0 ? 'СТ' : r + 'к'; };
  function uniq(a) { return a.filter(function (v, i, s) { return s.indexOf(v) === i; }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // «5–6, 8, 11» из списка этажей
  function compressFloors(list) {
    var f = uniq(list).sort(function (a, b) { return a - b; }), out = [], i = 0;
    while (i < f.length) {
      var s = f[i], e = f[i];
      while (i + 1 < f.length && f[i + 1] === e + 1) { e = f[++i]; }
      out.push(s === e ? '' + s : s + '–' + e); i++;
    }
    return out.join(', ');
  }

  // схематичная планировка (заглушка вместо реального чертежа)
  function planSvg(rooms) {
    var st = 'stroke="#16384c" stroke-width="3" fill="none" stroke-linejoin="round"';
    var s = '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">';
    s += '<path ' + st + ' d="M40 30 L150 45 L150 175 L40 175 Z"/>';          // контур
    s += '<path ' + st + ' d="M40 110 L150 110"/>';                            // деление
    s += '<path ' + st + ' d="M95 110 L95 175"/>';
    if (rooms >= 1) s += '<path ' + st + ' d="M95 30 L95 110"/>';
    if (rooms >= 2) s += '<path ' + st + ' d="M40 70 L95 70"/>';
    if (rooms >= 3) s += '<path ' + st + ' d="M95 145 L150 145"/>';
    s += '<circle cx="118" cy="92" r="6" ' + st + '/>';                        // мокрая точка
    s += '</svg>';
    return s;
  }

  function Widget(opts) {
    this.opts = opts;
    this.root = document.querySelector(opts.container);
    if (!this.root) { console.error('[Шахматка] контейнер не найден:', opts.container); return; }
    this.fav = {};
    this.load();
  }

  Widget.prototype.load = function () {
    var self = this;
    this.root.innerHTML = '<div class="shm"><div class="shm__error">Загрузка…</div></div>';
    fetch(this.opts.dataUrl)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        self.data = data;
        if (data.genplan && data.genplan.buildings && data.genplan.buildings.length) self.showGenplan();
        else self.showSelection('all');
      })
      .catch(function (e) {
        self.root.innerHTML = '<div class="shm"><div class="shm__error">Не удалось загрузить данные: ' + e.message + '</div></div>';
      });
  };

  Widget.prototype.flatsOf = function (id) {
    return this.data.flats.filter(function (f) { return id == null || id === 'all' || f.building === id; });
  };
  Widget.prototype.buildingById = function (id) {
    return (this.data.genplan.buildings || []).filter(function (b) { return b.id === id; })[0];
  };

  /* ====================================================== */
  /*  ЭКРАН 1 — ГЕНПЛАН                                       */
  /* ====================================================== */
  Widget.prototype.showGenplan = function () {
    var self = this, d = this.data, gp = d.genplan;

    var markers = gp.buildings.map(function (b) {
      var flats = self.flatsOf(b.id);
      var free = flats.filter(function (f) { return f.status === 'free'; }).length;
      var soldout = free === 0;
      var sub = b.tag ? b.tag : free + ' своб.';
      return '<button class="shm-gp__marker' + (soldout ? ' is-soldout' : '') + '" data-bld="' + esc(b.id) + '" ' +
        'style="left:' + b.xPct + '%;top:' + b.yPct + '%">' +
        '<span class="shm-gp__pill">' + esc(b.name) + '<small>' + esc(sub) + '</small></span>' +
        '<span class="shm-gp__pin"></span></button>';
    }).join('');

    var html = '<div class="shm">';
    html += '<h2 class="shm-gp__title">' + esc(d.project || 'Генплан') + '</h2>';
    html += '<p class="shm-gp__sub">Выберите дом на генплане</p>';
    html += '<div class="shm-gp">';
    html += '<img class="shm-gp__img" src="' + esc(gp.image || '') + '" alt="Генплан">';
    html += markers;
    html += '</div></div>';
    this.root.innerHTML = html;

    var wrap = this.root.querySelector('.shm-gp');
    var img = this.root.querySelector('.shm-gp__img');
    img.addEventListener('error', function () { self.genplanFallback(wrap); });

    this.root.querySelectorAll('.shm-gp__marker').forEach(function (el) {
      el.addEventListener('click', function () { self.showSelection(el.getAttribute('data-bld')); });
    });
  };

  // если genplan.jpg ещё не положили — показываем список домов кнопками
  Widget.prototype.genplanFallback = function (wrap) {
    var self = this;
    var btns = this.data.genplan.buildings.map(function (b) {
      return '<button class="shm__tab" data-bld="' + esc(b.id) + '" style="margin:4px">' + esc(b.name) + '</button>';
    }).join('');
    wrap.innerHTML = '<div class="shm-gp__fallback">Файл <b>genplan.jpg</b> не найден в папке виджета.<br>' +
      'Положите рендер рядом со скриптами — и здесь появятся кликабельные пины.<br><br>' +
      'Пока выберите дом списком:<br><br>' + btns + '</div>';
    wrap.querySelectorAll('[data-bld]').forEach(function (el) {
      el.addEventListener('click', function () { self.showSelection(el.getAttribute('data-bld')); });
    });
  };

  /* ====================================================== */
  /*  ЭКРАН 2 — ВЫБОР (фильтры + карточки/шахматка)           */
  /* ====================================================== */
  Widget.prototype.showSelection = function (buildingId) {
    var d = this.data, all = d.flats;
    this.view = 'cards';

    var roomTypes = uniq(all.map(function (f) { return f.rooms; })).sort(function (a, b) { return a - b; });
    var bounds = {
      price: [Math.min.apply(0, all.map(function (f) { return f.price; })), Math.max.apply(0, all.map(function (f) { return f.price; }))],
      area:  [Math.min.apply(0, all.map(function (f) { return f.area; })),  Math.max.apply(0, all.map(function (f) { return f.area; }))],
      floor: [Math.min.apply(0, all.map(function (f) { return f.floor; })), Math.max.apply(0, all.map(function (f) { return f.floor; }))]
    };
    this.bounds = bounds;
    this.f = {
      house: buildingId || 'all', rooms: {}, price: bounds.price.slice(), area: bounds.area.slice(),
      floor: bounds.floor.slice(), feature: '', promo: '', sort: 'price-asc'
    };

    var features = uniq([].concat.apply([], all.map(function (f) { return f.features || []; })));
    var promos = uniq(all.map(function (f) { return f.promo; }).filter(Boolean));
    var hasGp = d.genplan && d.genplan.buildings.length;

    var html = '<div class="shm">';
    if (hasGp) html += '<button class="shm__back" type="button">← К генплану</button>';

    // фильтры
    html += '<div class="shm__filters">';
    // дом
    html += fgroup('Выберите дом', '<select class="shm__select" data-f="house"><option value="all">Все дома</option>' +
      d.genplan.buildings.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === this.f.house ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }, this).join('') + '</select>');
    // комнаты
    html += fgroup('Комнат', '<div class="shm__rooms">' + roomTypes.map(function (r) {
      return '<button class="shm__room" data-room="' + r + '">' + (r === 0 ? 'Ст' : r) + '</button>';
    }).join('') + '</div>');
    // диапазоны
    html += fgroup('Цена, ₽', this.rangeHtml('price', 250000));
    html += fgroup('Площадь, м²', this.rangeHtml('area', 0.1));
    html += fgroup('Этаж', this.rangeHtml('floor', 1));
    // особенность
    html += fgroup('Особенность', '<select class="shm__select" data-f="feature"><option value="">Не выбрано</option>' +
      features.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') + '</select>');
    // акция
    html += fgroup('Акция', '<select class="shm__select" data-f="promo"><option value="">Не выбрано</option>' +
      promos.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') + '</select>');
    html += '<button class="shm__reset" type="button">Сбросить фильтры</button>';
    html += '</div>';

    // строка результатов
    html += '<div class="shm__resbar">';
    html += '<div class="shm__rescount"></div>';
    html += '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">';
    html += '<div class="shm__tabs"><button class="shm__tab is-active" data-view="cards">Планировки</button>' +
      '<button class="shm__tab" data-view="grid">Шахматка</button></div>';
    html += '<div class="shm__sort">Сортировка <select class="shm__sortsel" data-f="sort">' +
      '<option value="price-asc">Цена ↑</option><option value="price-desc">Цена ↓</option>' +
      '<option value="area-asc">Площадь ↑</option><option value="area-desc">Площадь ↓</option></select></div>';
    html += '</div></div>';

    html += '<div class="shm__results"></div>';
    html += '<div class="shm__overlay"></div><aside class="shm__panel"></aside>';
    html += '</div>';

    this.root.innerHTML = html;
    this.bindSelection();
    this.renderResults();
  };

  function fgroup(label, inner) { return '<div class="shm__fgroup"><span class="shm__flabel">' + label + '</span>' + inner + '</div>'; }

  Widget.prototype.rangeHtml = function (key, step) {
    var b = this.bounds[key], v = this.f[key];
    return '<div class="shm__range" data-range="' + key + '" data-min="' + b[0] + '" data-max="' + b[1] + '" data-step="' + step + '">' +
      '<div class="shm__range-vals"><span class="shm__range-lo"></span><span class="shm__range-hi"></span></div>' +
      '<div class="shm__range-track"><div class="shm__range-rail"></div><div class="shm__range-fill"></div>' +
      '<input type="range" class="shm__range-a" min="' + b[0] + '" max="' + b[1] + '" step="' + step + '" value="' + v[0] + '">' +
      '<input type="range" class="shm__range-b" min="' + b[0] + '" max="' + b[1] + '" step="' + step + '" value="' + v[1] + '">' +
      '</div></div>';
  };

  Widget.prototype.bindSelection = function () {
    var self = this, root = this.root;

    var back = root.querySelector('.shm__back');
    if (back) back.addEventListener('click', function () { self.showGenplan(); });

    root.querySelector('[data-f="house"]').addEventListener('change', function () { self.f.house = this.value; self.renderResults(); });
    root.querySelector('[data-f="feature"]').addEventListener('change', function () { self.f.feature = this.value; self.renderResults(); });
    root.querySelector('[data-f="promo"]').addEventListener('change', function () { self.f.promo = this.value; self.renderResults(); });
    root.querySelector('[data-f="sort"]').addEventListener('change', function () { self.f.sort = this.value; self.renderResults(); });

    root.querySelectorAll('.shm__room').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = btn.getAttribute('data-room');
        if (self.f.rooms[r]) { delete self.f.rooms[r]; btn.classList.remove('is-active'); }
        else { self.f.rooms[r] = true; btn.classList.add('is-active'); }
        self.renderResults();
      });
    });

    root.querySelectorAll('.shm__range').forEach(function (el) { self.bindRange(el); });

    root.querySelector('.shm__reset').addEventListener('click', function () { self.resetFilters(); });

    root.querySelectorAll('.shm__tab[data-view]').forEach(function (t) {
      t.addEventListener('click', function () {
        self.view = t.getAttribute('data-view');
        root.querySelectorAll('.shm__tab[data-view]').forEach(function (x) { x.classList.remove('is-active'); });
        t.classList.add('is-active');
        self.renderResults();
      });
    });

    root.querySelector('.shm__overlay').addEventListener('click', function () { self.closePanel(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.closePanel(); });
  };

  Widget.prototype.bindRange = function (el) {
    var self = this, key = el.getAttribute('data-range');
    var a = el.querySelector('.shm__range-a'), b = el.querySelector('.shm__range-b');
    var min = +el.getAttribute('data-min'), max = +el.getAttribute('data-max');
    var fill = el.querySelector('.shm__range-fill');
    var lo = el.querySelector('.shm__range-lo'), hi = el.querySelector('.shm__range-hi');
    var fmt = key === 'price' ? function (v) { return money(v); } : (key === 'area' ? function (v) { return v + ' м²'; } : function (v) { return v; });

    function upd(render) {
      var va = +a.value, vb = +b.value;
      if (va > vb) { var t = va; va = vb; vb = t; }
      self.f[key] = [va, vb];
      var p1 = (va - min) / (max - min) * 100, p2 = (vb - min) / (max - min) * 100;
      fill.style.left = p1 + '%'; fill.style.width = (p2 - p1) + '%';
      lo.textContent = fmt(va); hi.textContent = fmt(vb);
      if (render) self.renderResults();
    }
    a.addEventListener('input', function () { upd(true); });
    b.addEventListener('input', function () { upd(true); });
    upd(false);
  };

  Widget.prototype.resetFilters = function () {
    this.f.house = 'all'; this.f.rooms = {}; this.f.feature = ''; this.f.promo = ''; this.f.sort = 'price-asc';
    this.f.price = this.bounds.price.slice(); this.f.area = this.bounds.area.slice(); this.f.floor = this.bounds.floor.slice();
    this.showSelection('all'); // перерисовать панель целиком (сбросить ползунки/кнопки)
  };

  Widget.prototype.filtered = function (includeSold) {
    var f = this.f;
    return this.data.flats.filter(function (x) {
      if (!includeSold && x.status === 'sold') return false;
      if (f.house !== 'all' && x.building !== f.house) return false;
      if (Object.keys(f.rooms).length && !f.rooms[x.rooms]) return false;
      if (x.price < f.price[0] || x.price > f.price[1]) return false;
      if (x.area < f.area[0] || x.area > f.area[1]) return false;
      if (x.floor < f.floor[0] || x.floor > f.floor[1]) return false;
      if (f.feature && (x.features || []).indexOf(f.feature) < 0) return false;
      if (f.promo && x.promo !== f.promo) return false;
      return true;
    });
  };

  Widget.prototype.renderResults = function () {
    if (this.view === 'grid') return this.renderGrid();
    return this.renderCards();
  };

  /* ---------- вкладка «Планировки» ---------- */
  Widget.prototype.renderCards = function () {
    var self = this, d = this.data;
    var flats = this.filtered(false);

    // группировка по планировочному решению
    var groups = {};
    flats.forEach(function (x) {
      var k = x.building + '|' + x.rooms + '|' + x.area;
      (groups[k] = groups[k] || []).push(x);
    });
    var keys = Object.keys(groups);

    // сортировка групп
    var sort = this.f.sort;
    keys.sort(function (ka, kb) {
      var ga = groups[ka], gb = groups[kb];
      var pa = Math.min.apply(0, ga.map(function (x) { return x.price; })), pb = Math.min.apply(0, gb.map(function (x) { return x.price; }));
      if (sort === 'price-asc') return pa - pb;
      if (sort === 'price-desc') return pb - pa;
      if (sort === 'area-asc') return ga[0].area - gb[0].area;
      if (sort === 'area-desc') return gb[0].area - ga[0].area;
      return 0;
    });

    this.root.querySelector('.shm__rescount').innerHTML =
      flats.length + ' ' + plural(flats.length, ['квартира', 'квартиры', 'квартир']) +
      ', <span>' + keys.length + ' ' + plural(keys.length, ['планировочное решение', 'планировочных решения', 'планировочных решений']) + '</span>';

    var res = this.root.querySelector('.shm__results');
    if (!keys.length) { res.innerHTML = '<div class="shm__empty">Под фильтры ничего не подошло. Сбросьте часть условий.</div>'; return; }

    var cur = d.currency || '₽';
    res.innerHTML = '<div class="shm__cards">' + keys.map(function (k) {
      var g = groups[k], one = g[0];
      var bld = self.buildingById(one.building);
      var minP = Math.min.apply(0, g.map(function (x) { return x.price; }));
      var floors = compressFloors(g.map(function (x) { return x.floor; }));
      var promo = g.map(function (x) { return x.promo; }).filter(Boolean)[0];
      var fav = !!self.fav[k];
      return '<div class="shm__card" data-key="' + esc(k) + '">' +
        '<div class="shm__card-plan">' +
          '<span class="shm__rooms-badge">' + roomsLabel(one.rooms) + '</span>' +
          '<button class="shm__heart' + (fav ? ' is-on' : '') + '" data-fav="' + esc(k) + '">' + (fav ? '♥' : '♡') + '</button>' +
          planSvg(one.rooms) +
        '</div>' +
        '<div class="shm__card-body">' +
          '<div class="shm__card-row"><span class="shm__card-area">' + one.area + ' <sup>м²</sup></span>' +
            '<span class="shm__card-price">от ' + money(minP) + ' ' + cur + '</span></div>' +
          '<div class="shm__card-sub"><span>' + floors + ' этаж</span><span>' + esc(bld ? bld.name : '') + '</span></div>' +
          (promo ? '<span class="shm__card-promo">' + esc(promo) + '</span>' : '') +
        '</div></div>';
    }).join('') + '</div>';

    res.querySelectorAll('.shm__card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.shm__heart')) return;
        self.openGroupPanel(groups[card.getAttribute('data-key')]);
      });
    });
    res.querySelectorAll('.shm__heart').forEach(function (h) {
      h.addEventListener('click', function () {
        var k = h.getAttribute('data-fav');
        self.fav[k] = !self.fav[k];
        h.classList.toggle('is-on', self.fav[k]); h.textContent = self.fav[k] ? '♥' : '♡';
      });
    });
  };

  /* ---------- вкладка «Шахматка» ---------- */
  Widget.prototype.renderGrid = function () {
    var self = this, d = this.data;
    var flats = this.filtered(true);
    // шахматка показывается по одному дому: если выбраны «все» — берём дом первой квартиры
    var house = this.f.house;
    if (house === 'all') house = flats.length ? flats[0].building : (d.genplan.buildings[0] || {}).id;
    var bld = this.buildingById(house);
    flats = flats.filter(function (x) { return x.building === house; });

    var floors = uniq(flats.map(function (x) { return x.floor; })).sort(function (a, b) { return b - a; });
    var risers = uniq(flats.map(function (x) { return x.riser; })).sort(function (a, b) { return a - b; });

    this.root.querySelector('.shm__rescount').innerHTML = (bld ? esc(bld.name) + ' — ' : '') +
      flats.length + ' ' + plural(flats.length, ['квартира', 'квартиры', 'квартир']) +
      ' <span>(шахматка показывается по одному дому)</span>';

    var res = this.root.querySelector('.shm__results');
    if (!floors.length) { res.innerHTML = '<div class="shm__empty">Под фильтры ничего не подошло.</div>'; return; }

    var html = '<div class="shm__grid-wrap"><table class="shm__grid"><tbody>';
    html += '<tr><td></td>' + risers.map(function (r) { return '<td class="shm__riser-head">Стояк ' + r + '</td>'; }).join('') + '</tr>';
    floors.forEach(function (floor) {
      html += '<tr><td class="shm__floor-head">' + floor + ' эт.</td>';
      risers.forEach(function (riser) {
        var flat = flats.filter(function (x) { return x.floor === floor && x.riser === riser; })[0];
        if (!flat) { html += '<td><div class="shm__cell shm__cell--empty"></div></td>'; return; }
        var color = (d.statuses[flat.status] || {}).color || '#999';
        var cls = 'shm__cell' + (flat.status === 'sold' ? ' shm__cell--sold' : '');
        html += '<td><button class="' + cls + '" style="background:' + color + '" data-id="' + esc(flat.id) + '" data-status="' + flat.status + '">' +
          '<span class="shm__cell-num">№' + esc(flat.number) + '</span>' +
          '<span class="shm__cell-meta">' + roomsShort(flat.rooms) + ' · ' + flat.area + '</span></button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    res.innerHTML = html;

    res.querySelectorAll('.shm__cell[data-id]').forEach(function (cell) {
      if (cell.getAttribute('data-status') === 'sold') return;
      cell.addEventListener('click', function () { self.openFlatPanel(cell.getAttribute('data-id')); });
    });
  };

  /* ---------- панель: группа планировок ---------- */
  Widget.prototype.openGroupPanel = function (group) {
    var self = this, d = this.data, cur = d.currency || '₽';
    var one = group[0], bld = this.buildingById(one.building);
    var sorted = group.slice().sort(function (a, b) { return a.floor - b.floor; });
    var minP = Math.min.apply(0, group.map(function (x) { return x.price; }));

    var html = '<div class="shm__panel-head"><div>';
    html += '<h3 class="shm__panel-title">' + roomsLabel(one.rooms) + ' · ' + one.area + ' м²</h3>';
    html += '<p class="shm__panel-sub">' + esc(bld ? bld.name : '') + ' · ' + one.finishing + ' отделка</p>';
    html += '</div><button class="shm__close" aria-label="Закрыть">×</button></div>';
    html += '<div class="shm__plan">' + planSvg(one.rooms) + '</div>';
    html += '<div class="shm__price"><div class="shm__price-val">от ' + money(minP) + ' ' + cur + '</div>';
    html += '<div class="shm__price-meta">' + money(minP / one.area) + ' ' + cur + ' / м² · доступно ' + group.length + '</div></div>';
    html += '<div style="padding:0 22px 6px;font-size:13px;color:var(--shm-muted)">Свободные квартиры этой планировки:</div>';
    html += '<ul class="shm__flatlist">';
    sorted.forEach(function (x) {
      var st = d.statuses[x.status] || {};
      html += '<li class="shm__flatrow"><span><b>№' + esc(x.number) + '</b> · ' + x.floor + ' эт. · ' +
        '<span style="color:' + st.color + '">' + esc(st.label) + '</span></span>' +
        '<span style="display:flex;align-items:center;gap:12px">' + money(x.price) + ' ' + cur +
        '<button class="shm__flat-pick" data-id="' + esc(x.id) + '">Выбрать</button></span></li>';
    });
    html += '</ul>';

    var panel = this.root.querySelector('.shm__panel');
    panel.innerHTML = html;
    panel.querySelector('.shm__close').addEventListener('click', function () { self.closePanel(); });
    panel.querySelectorAll('.shm__flat-pick').forEach(function (btn) {
      btn.addEventListener('click', function () { self.lead(btn.getAttribute('data-id')); });
    });
    this.openPanel();
  };

  /* ---------- панель: одна квартира (из шахматки) ---------- */
  Widget.prototype.openFlatPanel = function (id) {
    var self = this, d = this.data, cur = d.currency || '₽';
    var flat = d.flats.filter(function (f) { return f.id === id; })[0];
    if (!flat) return;
    var st = d.statuses[flat.status] || {}, bld = this.buildingById(flat.building);

    var html = '<div class="shm__panel-head"><div>';
    html += '<h3 class="shm__panel-title">Квартира №' + esc(flat.number) + '</h3>';
    html += '<p class="shm__panel-sub">' + esc(bld ? bld.name : '') + ' · ' + roomsLabel(flat.rooms) + ' · ' + flat.floor + ' этаж</p>';
    html += '</div><button class="shm__close" aria-label="Закрыть">×</button></div>';
    html += '<div class="shm__plan">' + planSvg(flat.rooms) + '</div>';
    html += '<div style="padding:0 22px"><span class="shm__badge" style="background:' + (st.color || '#999') + '">' + esc(st.label) + '</span></div>';
    html += '<ul class="shm__specs">';
    html += '<li class="shm__spec"><span>Площадь</span><b>' + flat.area + ' м²</b></li>';
    html += '<li class="shm__spec"><span>Этаж</span><b>' + flat.floor + '</b></li>';
    html += '<li class="shm__spec"><span>Отделка</span><b>' + flat.finishing + '</b></li>';
    if (flat.features) html += '<li class="shm__spec"><span>Особенности</span><b>' + esc(flat.features.join(', ')) + '</b></li>';
    html += '</ul>';
    html += '<div class="shm__price"><div class="shm__price-val">' + money(flat.price) + ' ' + cur + '</div>';
    html += '<div class="shm__price-meta">' + money(flat.price / flat.area) + ' ' + cur + ' / м²</div></div>';
    html += '<button class="shm__cta" data-id="' + esc(flat.id) + '">' + (flat.status === 'reserved' ? 'Узнать про бронь' : 'Оставить заявку') + '</button>';

    var panel = this.root.querySelector('.shm__panel');
    panel.innerHTML = html;
    panel.querySelector('.shm__close').addEventListener('click', function () { self.closePanel(); });
    panel.querySelector('.shm__cta').addEventListener('click', function () { self.lead(flat.id); });
    this.openPanel();
  };

  Widget.prototype.lead = function (id) {
    var flat = this.data.flats.filter(function (f) { return f.id === id; })[0];
    if (typeof this.opts.onLead === 'function') this.opts.onLead(flat);
    else alert('Заявка по квартире №' + flat.number + '. Подключите onLead для интеграции с CRM/формой.');
  };

  Widget.prototype.openPanel = function () {
    this.root.querySelector('.shm__overlay').classList.add('is-open');
    this.root.querySelector('.shm__panel').classList.add('is-open');
  };
  Widget.prototype.closePanel = function () {
    var o = this.root.querySelector('.shm__overlay'), p = this.root.querySelector('.shm__panel');
    if (o) o.classList.remove('is-open'); if (p) p.classList.remove('is-open');
  };

  function plural(n, forms) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  global.Shahmatka = { init: function (opts) { return new Widget(opts); } };
})(window);

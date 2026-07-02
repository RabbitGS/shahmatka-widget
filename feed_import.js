#!/usr/bin/env node
/**
 * feed_import.js — импорт стандартного фида Яндекс.Недвижимости (YRL, XML)
 * в data.json виджета-шахматки. Node.js, без зависимостей.
 *
 * Запуск:
 *   node feed_import.js feed.xml [out.json]     // по умолчанию out = data_from_feed.json
 *
 * Чего фид НЕ даёт (важно, чтобы не врать клиенту):
 *   • Фид = только доступные лоты → все квартиры "free". Проданные/бронь в фиде
 *     отсутствуют; живые статусы подключаются позже через админку.
 *   • Стояк (riser) фид не передаёт → синтезируем по позиции лота на этаже.
 *   • Пины генплана фид не содержит → расставляем равномерно, поправить вручную.
 */
'use strict';
var fs = require('fs');

var YES = { 'да': 1, 'true': 1, '1': 1, '+': 1, 'yes': 1 };

function tag(block, name) {
  var m = block.match(new RegExp('<(?:\\w+:)?' + name + '\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?' + name + '>', 'i'));
  return m ? m[1].trim() : null;
}
function attr(block, name) {
  var m = block.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : null;
}
function value(block, name) { // <name> ... <value>X</value> ... </name>
  var inner = tag(block, name);
  if (inner == null) return null;
  var m = inner.match(/<(?:\w+:)?value\b[^>]*>([\s\S]*?)<\/(?:\w+:)?value>/i);
  return m ? m[1].trim() : null;
}
function num(s) {
  if (s == null) return null;
  s = String(s).replace(/[\s  ]/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function int(s) { var n = num(s); return n == null ? null : Math.round(n); }
function slug(s) {
  s = (s || '').trim().toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '');
  return s || 'house';
}
function deadlineOf(block) {
  var state = (tag(block, 'building-state') || '').toLowerCase();
  if (state === 'built' || state === 'hand-over') return 'Сдан';
  var rq = tag(block, 'ready-quarter'), by = tag(block, 'built-year');
  if (rq && by) return rq + ' кв. ' + by;
  return by || null;
}

function importFeed(xml) {
  var offers = xml.match(/<(?:\w+:)?offer\b[\s\S]*?<\/(?:\w+:)?offer>/gi) || [];
  if (!offers.length) throw new Error('В фиде не найдено ни одного <offer>. Проверьте формат YRL.');

  var flats = [], buildings = {}, deadlines = [];

  offers.forEach(function (off, i) {
    var studio = (tag(off, 'studio') || '').toLowerCase() in YES;
    var roomsRaw = tag(off, 'rooms');
    var rooms = studio ? 0 : (int(roomsRaw) != null ? int(roomsRaw) : 0);

    var area = num(value(off, 'area'));
    var price = num(value(off, 'price'));
    var floor = int(tag(off, 'floor'));
    var floorsTotal = int(tag(off, 'floors-total'));
    if (area == null || price == null || floor == null) return; // без ключевых полей лот бесполезен

    var section = tag(off, 'building-section');
    var houseId = tag(off, 'yandex-house-id');
    var bname = section || (houseId ? 'Корпус ' + houseId : 'Корпус 1');
    var bid = slug(bname);
    if (!buildings[bid]) buildings[bid] = { name: bname, tag: tag(off, 'building-name') || '' };

    var dl = deadlineOf(off);
    if (dl) deadlines.push(dl);

    var features = [];
    if (floorsTotal && floor === floorsTotal) features.push('Последний этаж');

    var id = attr(off, 'internal-id') || ('lot' + (i + 1));
    flats.push({
      id: id, number: id, building: bid, floor: floor, riser: 0,
      rooms: rooms, area: Math.round(area * 100) / 100, price: Math.round(price),
      status: 'free', finishing: tag(off, 'renovation') || 'уточняется', features: features
    });
  });

  if (!flats.length) throw new Error('Ни один offer не содержит area+price+floor — импортировать нечего.');

  // синтез стояков: в каждом (дом, этаж) сортируем и раздаём номера колонок
  var byBF = {};
  flats.forEach(function (f) { (byBF[f.building + '|' + f.floor] = byBF[f.building + '|' + f.floor] || []).push(f); });
  Object.keys(byBF).forEach(function (k) {
    byBF[k].sort(function (a, b) { return a.area - b.area || (a.id < b.id ? -1 : 1); });
    byBF[k].forEach(function (f, idx) { f.riser = idx + 1; });
  });

  // генплан: равномерные пины-заглушки
  var bids = Object.keys(buildings);
  var gp = bids.map(function (bid, idx) {
    return { id: bid, name: buildings[bid].name, tag: buildings[bid].tag,
      xPct: Math.round((idx + 1) * 100 / (bids.length + 1)), yPct: 50 };
  });

  var deadline = null;
  if (deadlines.length) {
    var cnt = {}; deadlines.forEach(function (d) { cnt[d] = (cnt[d] || 0) + 1; });
    deadline = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
  }

  var data = {
    project: 'Импортировано из фида', currency: '₽',
    mortgage: { rate: 0.06, years: 30, down: 0.2 },
    banks: [
      { name: 'Сбербанк', program: 'Семейная', rate: 0.06 },
      { name: 'ВТБ', program: 'Семейная', rate: 0.06 },
      { name: 'ДОМ.РФ', program: 'Семейная', rate: 0.06 }
    ],
    genplan: { image: 'genplan.jpg', buildings: gp },
    statuses: {
      free: { label: 'Свободна', color: '#3f9d58' },
      reserved: { label: 'Бронь', color: '#e0a312' },
      sold: { label: 'Продана', color: '#c0392b' }
    },
    flats: flats
  };
  if (deadline) data.deadline = deadline;
  return { data: data, total: offers.length };
}

function main() {
  var feed = process.argv[2] || process.env.FEED_XML || 'feed.xml';
  var out = process.argv[3] || 'data_from_feed.json';
  if (!fs.existsSync(feed)) { console.error('Файл фида не найден: ' + feed); process.exit(1); }

  var res = importFeed(fs.readFileSync(feed, 'utf8'));
  fs.writeFileSync(out, JSON.stringify(res.data, null, 2), 'utf8');

  var kept = res.data.flats.length, houses = res.data.genplan.buildings.length;
  console.log('Фид: ' + feed);
  console.log('Offer в фиде: ' + res.total + ' → импортировано лотов: ' + kept + ' (пропущено без ключевых полей: ' + (res.total - kept) + ')');
  console.log('Домов/корпусов: ' + houses + ' · срок сдачи: ' + (res.data.deadline || '—'));
  console.log('Записано: ' + out);
  console.log('⚠️ Поправить вручную: пины xPct/yPct на генплане; при наличии — реальные стояки и статусы.');
}

if (require.main === module) main();
module.exports = { importFeed: importFeed };

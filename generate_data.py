# -*- coding: utf-8 -*-
"""Генератор data.json для виджета «Шахматка» — ЖК «Крылья» (Тверь).

Источник данных — реальный фид застройщика (xlsx). openpyxl не нужен:
читаем xlsx как zip и парсим XML (sheet + sharedStrings).

Фид: лист «Крылья», шапка в строке 4, данные строки 5..101.
Колонки: A=№кв, B=подъезд, C=этаж, D=кол-во комнат, E=площадь,
         F=цена/м², G=Стоимость кв-ры (Ипотека/100% оплата) — берём как цену.
Статуса в фиде НЕТ → все квартиры свободны (free).

Структура: подъезды 7,8 = секция 1; 9,10 = секция 2 (в продаже 7–10).
Стояк (riser) синтезируем по типу планировки внутри подъезда; при коллизии
(несколько квартир одного типа на этаже = зеркальные) добавляем доп. стояк.

Запуск:  python generate_data.py
"""
import json, zipfile, os
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# --- путь к фиду (в vault, рядом с материалами Крыльев) ---
FEED = os.environ.get(
    "KRYLIA_FEED",
    os.path.join(os.path.dirname(__file__), "..", "wiki",
                 "материалы крылья", "ЖК Крылья фид ,  17.06.2026  .xlsx"),
)

# секции по подъезду
SECTION = {7: 1, 8: 1, 9: 2, 10: 2}

# Привязка планировок: (подъезд, комнаты, площадь) -> файл в plans/
# None = точного техплана нет, рисуем SVG-схему + пометку «уточняется».
PLANS = {
    (7, 1, 44.33): "plans/p_44_3_p7.webp",
    (7, 2, 72.52): "plans/p_72_5_p7.webp",
    (7, 2, 83.05): "plans/p_83_p7.webp",
    (8, 1, 45.38): "plans/p_45_3_p8.webp",
    (8, 2, 64.86): "plans/p_64_8_p8.webp",
    (8, 2, 71.07): "plans/p_71_07_p8.webp",
    (9, 1, 41.34): None,
    (9, 1, 45.38): "plans/p_45_3_p9.webp",
    (9, 2, 63.59): None,
    (9, 2, 64.86): "plans/p_64_8_p9.webp",
    (10, 1, 44.13): "plans/p_44_1_p10.webp",
    (10, 2, 63.59): None,
    (10, 2, 69.43): "plans/p_69_4_p10.webp",
    (10, 3, 90.38): "plans/p_90_p10.webp",
    (10, 3, 91.83): "plans/p_91_8_p10.webp",
}

# координаты пинов подъездов на генплане (% от ширины/высоты).
# Генплан = картинка ChatGPT (05.07.2026). Подъезды 7–10 на ДВОРОВОМ фасаде
# правого крыла, входы со двора; порядок сверху вниз: 7 (дальний/наружу) → 10 (у башни/двор).
PIN = {
    7:  {"xPct": 64.0, "yPct": 28.0},
    8:  {"xPct": 68.0, "yPct": 35.5},
    9:  {"xPct": 68.5, "yPct": 42.0},
    10: {"xPct": 73.0, "yPct": 49.0},
}


def read_feed(path):
    with zipfile.ZipFile(path) as z:
        ss = []
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            ss.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
        # лист может называться по-разному — берём первый worksheet
        sheet_name = [n for n in z.namelist()
                      if n.startswith("xl/worksheets/") and n.endswith(".xml")][0]
        ws = ET.fromstring(z.read(sheet_name))

    def col_letter(ref):
        return "".join(c for c in ref if c.isalpha())

    rows = []
    for row in ws.iter(f"{NS}row"):
        rn = int(row.get("r"))
        if rn < 5:
            continue
        cells = {}
        for c in row.findall(f"{NS}c"):
            col = col_letter(c.get("r"))
            t = c.get("t")
            v = c.find(f"{NS}v")
            if v is None:
                continue
            cells[col] = ss[int(v.text)] if t == "s" else v.text
        if "A" in cells:
            rows.append(cells)
    return rows


def main():
    rows = read_feed(FEED)
    raw = []
    for c in rows:
        raw.append({
            "num": str(c["A"]).strip(),
            "ent": int(float(c["B"])),
            "floor": int(float(c["C"])),
            "rooms": int(float(c["D"])),
            "area": round(float(c["E"]), 2),
            "price": int(round(float(c["G"]))),
        })

    # --- стояки: внутри подъезда сколько стояков нужно каждому типу ---
    from collections import defaultdict, Counter
    ents = sorted({r["ent"] for r in raw})
    riser_of = {}      # id(квартиры по индексу) -> riser
    for ent in ents:
        efl = [r for r in raw if r["ent"] == ent]
        types = sorted({(r["rooms"], r["area"]) for r in efl})
        # сколько стояков типу = макс. число квартир этого типа на одном этаже
        need = {}
        for t in types:
            per_floor = Counter(r["floor"] for r in efl
                                if (r["rooms"], r["area"]) == t)
            need[t] = max(per_floor.values())
        # назначаем стартовый индекс стояка каждому типу
        start, idx = {}, 1
        for t in types:
            start[t] = idx
            idx += need[t]
        # раскладываем квартиры по стоякам: на этаже сортируем по № и кладём по порядку
        by_floor_type = defaultdict(list)
        for r in efl:
            by_floor_type[(r["floor"], (r["rooms"], r["area"]))].append(r)
        for (fl, t), lst in by_floor_type.items():
            for off, r in enumerate(sorted(lst, key=lambda x: x["num"])):
                riser_of[id(r)] = start[t] + off

    # --- сборка квартир ---
    flats = []
    max_floor = max(r["floor"] for r in raw)
    for r in raw:
        key = (r["ent"], r["rooms"], r["area"])
        flat = {
            "id": "kr" + r["num"],
            "number": r["num"],
            "building": "p" + str(r["ent"]),
            "floor": r["floor"],
            "riser": riser_of[id(r)],
            "rooms": r["rooms"],
            "area": r["area"],
            "price": r["price"],
            "status": "free",
            "finishing": "под ключ",
        }
        plan = PLANS.get(key, "MISSING")
        if plan == "MISSING":
            print("  ⚠ нет привязки плана для", key)
        elif plan:
            flat["plan"] = plan
        feats = []
        if r["floor"] == max_floor:
            feats.append("Последний этаж")
        if feats:
            flat["features"] = feats
        flats.append(flat)

    # --- генплан: 4 подъезда как кликабельные «дома» ---
    buildings = []
    for ent in ents:
        cnt = sum(1 for f in flats if f["building"] == "p" + str(ent))
        buildings.append({
            "id": "p" + str(ent),
            "name": "Подъезд " + str(ent),
            "tag": "секция " + str(SECTION[ent]),
            "floors_label": "10 этажей · " + str(cnt) + " кв.",
            "xPct": PIN[ent]["xPct"],
            "yPct": PIN[ent]["yPct"],
        })

    data = {
        "project": "ЖК «Крылья»",
        "currency": "₽",
        "deadline": "IV кв. 2026",
        "mortgage": {"rate": 0.06, "years": 30, "down": 0.2},
        "banks": [
            {"name": "Сбербанк", "program": "Семейная", "rate": 0.06},
            {"name": "ВТБ", "program": "Семейная", "rate": 0.06},
            {"name": "ДОМ.РФ", "program": "Семейная", "rate": 0.06},
            {"name": "Альфа-Банк", "program": "Семейная", "rate": 0.06},
        ],
        "genplan": {
            "image": "genplan.jpg",
            "buildings": buildings,
        },
        "statuses": {
            "free":     {"label": "Свободна", "color": "#3f9d58"},
            "reserved": {"label": "Бронь",    "color": "#e0a312"},
            "sold":     {"label": "Продана",  "color": "#c0392b"},
        },
        "flats": flats,
    }

    out = os.path.join(os.path.dirname(__file__), "data.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("data.json готов. Подъездов:", len(buildings), "| квартир:", len(flats))
    no_plan = sum(1 for f in flats if "plan" not in f)
    print("Квартир без техплана (SVG-схема):", no_plan)


if __name__ == "__main__":
    main()

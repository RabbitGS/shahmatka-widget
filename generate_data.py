# -*- coding: utf-8 -*-
"""Генератор data.json для виджета «Шахматка».
Детерминированный (seed фиксирован). Правишь конфиг → python generate_data.py.
"""
import json, random

random.seed(42)

# Шаблоны квартир по стояку: rooms -> (area, base_price_per_m)
RISER_TYPES = {
    1: (0, 27.4, 150000),   # студия
    2: (1, 38.1, 150000),   # 1-комн
    3: (2, 61.5, 105000),   # 2-комн
    4: (3, 86.5, 100000),   # 3-комн
}

# Этапы/дома: id, имя, тег, этажность, стояки, координаты пина на рендере (% от ширины/высоты)
BUILDINGS = [
    {"id": "e1", "name": "60 — 1 этап", "tag": "дом сдан", "floors": 13, "risers": [1, 2, 3, 4], "xPct": 33.9, "yPct": 54.0},
    {"id": "e2", "name": "60 — 2 этап", "tag": None,        "floors": 9,  "risers": [1, 2, 3],    "xPct": 31.5, "yPct": 40.3},
    {"id": "e3", "name": "60 — 3 этап", "tag": None,        "floors": 16, "risers": [1, 2],       "xPct": 41.8, "yPct": 26.2},
]

def pick_status(floor, floors):
    ratio = floor / floors
    r = random.random()
    if ratio < 0.35:
        return "sold" if r < 0.6 else ("reserved" if r < 0.78 else "free")
    if ratio < 0.7:
        return "sold" if r < 0.28 else ("reserved" if r < 0.42 else "free")
    return "reserved" if r < 0.14 else "free"

flats = []
seq = 0
for b in BUILDINGS:
    for floor in range(1, b["floors"] + 1):
        for riser in b["risers"]:
            seq += 1
            rooms, area, ppm = RISER_TYPES[riser]
            floor_premium = 1 + (floor - 1) * 0.004
            top = floor == b["floors"]
            a = round(area + (riser * 0.05) + (2.4 if top else 0), 1)  # лёгкий разброс площадей
            price = round(a * ppm * floor_premium * (1.07 if top else 1) / 250) * 250
            status = pick_status(floor, b["floors"])
            flat = {
                "id": "31" + str(6000 + seq),
                "number": str(seq),
                "building": b["id"],
                "floor": floor,
                "riser": riser,
                "rooms": rooms,
                "area": a,
                "price": int(price),
                "status": status,
                "finishing": "чистовая" if top else "черновая",
            }
            # особенности и акции
            feats = []
            if top:
                feats.append("Последний этаж")
            if riser in (1, b["risers"][-1]):
                feats.append("Угловая")
            if feats:
                flat["features"] = feats
            if top and status == "free":
                flat["promo"] = "Скидка 5%"
            flats.append(flat)

data = {
    "project": "ЖК «Атмосфера»",
    "currency": "₽",
    "genplan": {
        "image": "genplan.jpg",
        "buildings": [
            {"id": b["id"], "name": b["name"], "tag": b["tag"],
             "floors_label": str(b["floors"]) + " этажей",
             "xPct": b["xPct"], "yPct": b["yPct"]}
            for b in BUILDINGS
        ],
    },
    "statuses": {
        "free":     {"label": "Свободна", "color": "#3f9d58"},
        "reserved": {"label": "Бронь",    "color": "#e0a312"},
        "sold":     {"label": "Продана",  "color": "#c0392b"},
    },
    "flats": flats,
}

with open("data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("data.json готов. Этапов:", len(BUILDINGS), "| квартир:", len(flats))

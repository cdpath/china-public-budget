"""Parse data/raw/{year}.htm into data/budget.jsonl, data/budget.json and docs/data.json.

Hierarchy: 类 (level 1) > 款 (level 2) > 项 (level 3).

Indentation in the source HTML is inconsistent between years (some years lost
their tabs), so the tree is rebuilt from content instead:
  * 类 rows start with a Chinese numeral and "、".
  * "其中：" marks the first child of the previous row.
  * Only 类/款 rows carry a 预算数; 项 rows never do.
  * A 款 is complete once its 项 sum to the 款 決算数, so the next row starts a new 款.
"""

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

LEI_RE = re.compile(r"^([一二三四五六七八九十廿]+)、(.+)$")
TOTAL_NAME = "全国一般公共预算支出"
VALUE_KEYS = ("budget", "adjusted_budget", "actual", "pct_of_budget", "pct_of_prev_year")

# Old name -> current name, so renamed items line up across years. Several old names may map to
# one key (e.g. 工商行政管理事务 + 质量技术监督与检验检疫事务 merged into 市场监督管理事务).
LEI_ALIASES = {
    "文化体育与传媒支出": "文化旅游体育与传媒支出",
    "医疗卫生与计划生育支出": "卫生健康支出",
    "资源勘探信息等支出": "资源勘探工业信息等支出",
    "国土海洋气象等支出": "自然资源海洋气象等支出",
}
KUAN_ALIASES = {
    "一般公共服务支出": {"工商行政管理事务": "市场监督管理事务",
                  "质量技术监督与检验检疫事务": "市场监督管理事务"},
    "公共安全支出": {"武装警察": "武装警察部队"},
    "社会保障和就业支出": {"行政事业单位离退休": "行政事业单位养老支出"},
    "卫生健康支出": {"医疗卫生与计划生育管理事务": "卫生健康管理事务",
               "其他医疗卫生与计划生育支出": "其他卫生健康支出",
               "中医药": "中医药事务"},
    "文化旅游体育与传媒支出": {"文化": "文化和旅游",
                    "其他文化体育与传媒支出": "其他文化旅游体育与传媒支出"},
    "农林水支出": {"农业": "农业农村", "林业": "林业和草原",
              "巩固脱贫衔接乡村振兴": "巩固脱贫攻坚成果衔接乡村振兴"},
    "节能环保支出": {"退耕还林": "退耕还林还草"},
    "资源勘探工业信息等支出": {"其他资源勘探信息等支出": "其他资源勘探工业信息等支出",
                    "工业和信息产业监管": "工业和信息产业"},
    "自然资源海洋气象等支出": {"国土资源事务": "自然资源事务"},
    "灾害防治及应急管理支出": {"消防事务": "消防救援事务", "煤矿安全": "矿山安全"},
    "粮油物资储备支出": {"粮油事务": "粮油物资事务"},
    "其他支出": {"其他支出(项)": "其他支出"},
}


def assign_keys(categories):
    for l in categories:
        l["key"] = LEI_ALIASES.get(l["name"], l["name"])
        aliases = KUAN_ALIASES.get(l["key"], {})
        for k in l["children"]:
            k["key"] = aliases.get(k["name"], k["name"])
            for x in k.get("children", []):
                x["key"] = x["name"]


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return re.sub(r"[\s\u3000\xa0]+", "", s)


def num(s):
    s = s.replace(",", "").replace("，", "")
    if s in ("", "-", "—", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def column_key(header):
    if header.startswith("调整"):
        return "adjusted_budget"
    if header == "预算数":
        return "budget"
    if header == "决算数":
        return "actual"
    if "上年" in header:
        return "pct_of_prev_year"
    if "预算数" in header:
        return "pct_of_budget"
    return None


def rows(year):
    """Yield (name, values) with values keyed by column_key; 2023 has an extra 调整预算数 column."""
    text = (RAW / f"{year}.htm").read_text(encoding="utf-8")
    keys = None
    for tr in re.findall(r"<tr.*?</tr>", text, re.S | re.I):
        cells = [clean(td) for td in re.findall(r"<td.*?</td>", tr, re.S | re.I)]
        if len(cells) < 3 or not cells[0]:
            continue
        if cells[0].startswith("项目"):
            keys = [column_key(h) for h in cells[1:]]
            continue
        if keys is None:
            continue
        values = {k: None for k in VALUE_KEYS}
        for k, v in zip(keys, cells[1:]):
            if k:
                values[k] = num(v)
        yield cells[0], values


def tol(n):
    # Each published figure is rounded to 0.01, so a sum of n figures drifts by at most 0.005 * n.
    return 0.0051 * max(n, 1) + 0.001


def close(a, b, n):
    return abs((a or 0) - (b or 0)) <= tol(n)


def total_of(nodes):
    return sum(n["actual"] or 0 for n in nodes)


def parse_year(year):
    tree = []
    total = None
    extras = []
    lei = kuan = None
    after_total = False

    for name, values in rows(year):
        node = {"name": name, **values}
        budget, actual = values["budget"], values["actual"]
        m = LEI_RE.match(name)
        if name == TOTAL_NAME:
            total = node
            after_total = True
            continue
        if after_total:
            if not name.startswith("注"):
                extras.append(node)
            continue
        if m:
            node["name"] = m.group(2)
            node["children"] = []
            lei, kuan = node, None
            tree.append(lei)
            continue
        if lei is None:
            continue

        first_child = name.startswith("其中")
        node["name"] = re.sub(r"^其中[：:]", "", name)

        fits = total_of(lei["children"]) + (actual or 0) <= (lei["actual"] or 0) + tol(len(lei["children"]) + 1)
        if kuan is None:
            is_kuan = True
        elif first_child:
            # A 款 with no 决算数 (e.g. 2020 年初预留) can't have 项, so its "其中" row is a sibling.
            is_kuan = kuan["actual"] is None and actual is not None
            if kuan["children"]:
                print(f"warn {year}: 其中 after 款 that already has 项: {name}", file=sys.stderr)
        elif budget is not None:
            is_kuan = True
        elif node["name"] == f"其他{kuan['name']}支出":
            is_kuan = False
        elif not fits:
            is_kuan = False
        elif not kuan["children"]:
            is_kuan = True
        else:
            is_kuan = close(total_of(kuan["children"]), kuan["actual"], len(kuan["children"]))

        if is_kuan:
            node["children"] = []
            kuan = node
            lei["children"].append(kuan)
        else:
            kuan["children"].append(node)

    for l in tree:
        for k in l["children"]:
            if not k["children"]:
                del k["children"]
    assign_keys(tree)
    return {"year": year, "unit": "亿元", "total": total, "extras": extras, "categories": tree}


def validate(y):
    """Return (errors, warnings).

    The 类 must add up to the total. 款/项 lists are partial ("其中"), so they only must not
    exceed their parent. The source itself has a few small overflows (e.g. 2017 污染防治 项 sum
    1883.75 vs 1883.02), so overflows under 1% are warnings.
    """
    errors, warnings = [], []
    cats = y["categories"]
    if not close(total_of(cats), y["total"]["actual"], len(cats)):
        errors.append(f"类 sum {total_of(cats):.2f} != total {y['total']['actual']}")

    def check(label, children, parent):
        s, p = total_of(children), parent or 0
        if children and s > p + tol(len(children)):
            (errors if s > p * 1.01 + 0.1 else warnings).append(f"{label}: sum {s:.2f} > {parent}")

    for l in cats:
        check(l["name"], l["children"], l["actual"])
        for k in l["children"]:
            check(f"{l['name']}/{k['name']}", k.get("children", []), k["actual"])
    return errors, warnings


def flatten(y):
    base = {"year": y["year"], "unit": y["unit"]}
    yield {**base, "level": 0, "path": [TOTAL_NAME], "key_path": [TOTAL_NAME], "name": TOTAL_NAME,
           **{k: y["total"][k] for k in VALUE_KEYS}}

    def walk(nodes, path, key_path, level):
        for n in nodes:
            p, kp = path + [n["name"]], key_path + [n["key"]]
            yield {**base, "level": level, "path": p, "key_path": kp, "name": n["name"],
                   **{k: n[k] for k in VALUE_KEYS}}
            yield from walk(n.get("children", []), p, kp, level + 1)

    yield from walk(y["categories"], [], [], 1)


def main():
    years = sorted(int(p.stem) for p in RAW.glob("*.htm"))
    data = []
    ok = True
    for year in years:
        y = parse_year(year)
        errors, warnings = validate(y)
        n_k = sum(len(l["children"]) for l in y["categories"])
        n_x = sum(len(k.get("children", [])) for l in y["categories"] for k in l["children"])
        print(f"{year}: 类 {len(y['categories'])}, 款 {n_k}, 项 {n_x}, total {y['total']['actual']}")
        for p in errors:
            ok = False
            print("    ERROR", p)
        for p in warnings:
            print("    warn ", p)
        data.append(y)

    out = ROOT / "data"
    (out / "budget.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    with (out / "budget.jsonl").open("w", encoding="utf-8") as f:
        for y in data:
            for row in flatten(y):
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
    (ROOT / "docs" / "data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                             encoding="utf-8")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

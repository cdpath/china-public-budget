# 全国一般公共预算支出 2017–2025

可视化：<https://cdpath.github.io/china-public-budget/>

财政部公布的 2017–2025 年《全国一般公共预算支出决算表》，整理为 JSON / JSONL，并做成可下钻的堆叠图（类 → 款 → 项）。

## 数据

单位：亿元。

- `data/budget.jsonl`：每行一个科目、一个年份。
  ```json
  {"year": 2025, "unit": "亿元", "level": 2, "path": ["社会保障和就业支出", "最低生活保障"], "key_path": ["社会保障和就业支出", "最低生活保障"], "name": "最低生活保障", "budget": 2160.34, "adjusted_budget": null, "actual": 1987.54, "pct_of_budget": 92.0, "pct_of_prev_year": 100.7}
  ```
  - `level`：0 总计，1 类，2 款，3 项
  - `path`：原表名称路径；`key_path`：按现名统一后的路径，用于跨年对比
  - `budget` 预算数，`adjusted_budget` 调整预算数（只有 2023 年有），`actual` 决算数
  - `pct_of_budget` 决算数为预算数的 %（2023 年为调整后预算数），`pct_of_prev_year` 决算数为上年决算数的 %
- `data/budget.json`：同样的数据，按年份组织成树。`extras` 是总计之后的行，比如“补充中央预算稳定调节基金”。
- `data/raw/`：原始网页快照。

注意：

- 原表中的“其中”只列出主要的款和项，所以下级合计通常小于上级。
- 部分科目在年份之间更名或合并，比如“医疗卫生与计划生育支出”改为“卫生健康支出”，“行政事业单位离退休”改为“行政事业单位养老支出”。对照表见 `scripts/parse.py` 中的 `LEI_ALIASES` 和 `KUAN_ALIASES`。
- 原表本身有少量下级合计略大于上级的情况，比如 2017 年“污染防治”各项合计 1883.75，表中的款为 1883.02。解析时这些情况会作为警告列出。

## 重新生成

```sh
python3 scripts/fetch.py   # 下载 README 中列出的页面到 data/raw/
python3 scripts/parse.py   # 生成 data/budget.json(l) 和 docs/data.json，并校验合计
```

只依赖 Python 标准库。可视化是 `docs/` 下的静态页面，通过 GitHub Pages 发布。

## 来源

[2017年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/qgczjs/201807/t20180712_2959592.htm)

[2018年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2018czjs/201907/t20190718_3303195.htm)

[2019年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2019qgczjs/202007/t20200731_3559718.htm)

[2020年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2020zyjs/202109/t20210917_3753571.htm)

[2021年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2021zyjs/202207/t20220728_3830482.htm)

[2022年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2022zyjs/202308/t20230825_3904170.htm)

[2023年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2023zyjs/202408/t20240830_3942884.htm)

[2024年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2024zyjs/202509/t20250904_3971520.htm)

[2025年全国一般公共预算支出决算表National General Public Budget Expenditure](https://yss.mof.gov.cn/2025zyjs/202609/t20260916_3997526.htm)



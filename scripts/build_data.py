# -*- coding: utf-8 -*-
"""Build the static knowledge-base dataset (assets/js/data.js) from the source DOCX.

Usage:
    python scripts/build_data.py [path/to/source.docx]

The site is completely static: data.js assigns window.LIBRARY, so index.html can be
opened directly from disk (file://) or served by GitHub Pages.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from docx import Document

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "source" / "真题完形补文词汇总表.docx"
FALLBACK_SRC = Path(r"C:\Users\Administrator\Desktop\真题完形补文词汇总表.docx")
OUT = ROOT / "assets" / "js" / "data.js"

HEADER_RE = re.compile(r"^=+\s*(.+?)\s*=+$")
ARTICLE_RE = re.compile(r"^(?P<en>.+?)（(?P<inner>[^（）]+)）\s*(?P<range>第[^　\s]*题)?\s*$")
ITEM_RE = re.compile(
    r"^(?P<base>.+?)（(?P<pos>[^（）]*)）(?P<gloss>.*?)\s*→\s*"
    r"【(?P<answer>.+?)】（(?P<apos>[^（）]*)）(?P<agloss>.*)$"
)

TAG_ORDER = [
    ("比较级", "比较级"),
    ("复数", "名词复数"),
    ("三单", "第三人称单数"),
    ("第三人称", "第三人称单数"),
    ("过去式", "过去式"),
    ("过去分词", "过去分词"),
    ("动名词", "动名词"),
    ("现在分词", "现在分词"),
    ("副词", "副词"),
    ("名词", "名词化"),
    ("形容词", "形容词"),
    ("介词", "介词"),
    ("动词", "动词"),
]

NEG_PREFIXES = ("un", "in", "im", "ir", "il", "dis", "non")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\u3000", " ")).strip()


def derive_tags(pos: str, base: str, answer: str) -> list[str]:
    tags = ["其他"]
    for needle, label in TAG_ORDER:
        if needle in pos:
            tags = [label]
            break
    low_base, low_ans = base.lower(), answer.lower()
    for prefix in NEG_PREFIXES:
        if low_ans.startswith(prefix) and not low_base.startswith(prefix):
            tags.append("否定前缀")
            break
    if "/" in answer:
        tags.append("多答案")
    return tags


def parse_docx(src: Path) -> dict:
    doc = Document(str(src))
    paragraphs = [p.text for p in doc.paragraphs]

    papers: list[dict] = []
    current = None
    pending_header = None
    warnings: list[str] = []

    for raw in paragraphs:
        text = clean(raw)
        if not text:
            continue
        if text.startswith("自考英语") or text.startswith("共收录"):
            continue

        m = HEADER_RE.match(text)
        if m:
            pending_header = m.group(1)
            current = None
            continue

        if pending_header and "（" in text and "）" in text and "→" not in text:
            am = ARTICLE_RE.match(text)
            if not am:
                warnings.append(f"标题无法解析：{text}")
                continue
            inner = am.group("inner")
            parts = [clean(x) for x in inner.split("·")]
            zh = parts[0] if parts else ""
            label = pending_header
            ym = re.match(r"(\d{4})年(\d{1,2})月", label)
            year = int(ym.group(1)) if ym else 0
            month = int(ym.group(2)) if ym else 0
            current = {
                "id": f"{year:04d}-{month:02d}" if ym else label,
                "year": year,
                "month": month,
                "label": label,
                "en": clean(am.group("en")),
                "zh": zh,
                "range": clean(am.group("range") or "第41~50题"),
                "items": [],
            }
            papers.append(current)
            pending_header = None
            continue

        if "→" in text and current is not None:
            im = ITEM_RE.match(text)
            if not im:
                warnings.append(f"词条无法解析：{text}")
                continue
            base = clean(im.group("base"))
            pos = clean(im.group("pos"))
            gloss = clean(im.group("gloss"))
            answer = clean(im.group("answer"))
            apos = clean(im.group("apos"))
            agloss = clean(im.group("agloss"))
            idx = len(current["items"]) + 1
            current["items"].append(
                {
                    "i": idx,
                    "base": base,
                    "pos": pos,
                    "gloss": gloss,
                    "answer": answer,
                    "apos": apos,
                    "agloss": agloss,
                    "tags": derive_tags(apos, base, answer),
                }
            )
            continue

        if current is not None:
            warnings.append(f"未归类段落：{text}")

    for p in papers:
        if not p["items"]:
            warnings.append(f"考期无词条：{p['label']}")

    meta = {
        "title": "真题完形补文词汇文库",
        "subtitle": "自考英语（专升本）· 历年真题完形补文词汇对照",
        "source": src.name,
        "generatedAt": datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M"),
        "totalPapers": len(papers),
        "totalItems": sum(len(p["items"]) for p in papers),
    }
    return {"meta": meta, "papers": papers, "warnings": warnings}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    elif DEFAULT_SRC.exists():
        src = DEFAULT_SRC
    else:
        src = FALLBACK_SRC
    data = parse_docx(src)
    payload = {"meta": data["meta"], "papers": data["papers"]}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, indent=2, separators=(",", ": "))
    OUT.write_text(
        "/* 此文件由 scripts/build_data.py 自动生成，请勿手工修改。 */\n"
        "window.LIBRARY = " + body + ";\n",
        encoding="utf-8",
    )

    tags = Counter(t for p in data["papers"] for it in p["items"] for t in it["tags"][:1])
    print(f"OK  papers={len(data['papers'])}  items={payload['meta']['totalItems']}")
    print("tags:", dict(tags))
    for w in data["warnings"]:
        print("WARN:", w)
    print("out:", OUT)


if __name__ == "__main__":
    main()

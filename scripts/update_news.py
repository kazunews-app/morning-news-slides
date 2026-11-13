#!/usr/bin/env python3
"""
GitHub Actions / ローカル環境から毎朝のトレンドニュースを取得し、
(GEMINI_API_KEY があれば Gemini API で要約して) data/news.js を更新します。
標準ライブラリのみで動作するため追加パッケージは不要です。
"""

from __future__ import annotations

import datetime
import html
import json
import os
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

JST = datetime.timezone(datetime.timedelta(hours=9))
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_JS_PATH = PROJECT_ROOT / "data" / "news.js"

FEEDS = [
    {
        "category": "domestic",
        "label": "国内・総合",
        "url": "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
        "limit": 2,
        "images": ["assets/images/news-1.jpg", "assets/images/news-2.jpg"],
    },
    {
        "category": "tech",
        "label": "テクノロジー・AI",
        "url": "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja",
        "limit": 2,
        "images": ["assets/images/news-3.jpg", "assets/images/news-4.jpg"],
    },
    {
        "category": "business",
        "label": "ビジネス・経済",
        "url": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja",
        "limit": 2,
        "images": ["assets/images/news-5.jpg", "assets/images/news-6.jpg"],
    },
]

DOW_JP = ["月", "火", "水", "木", "金", "土", "日"]


def clean_html(raw: str | None) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch_rss_items() -> list[dict]:
    collected: list[dict] = []
    for feed in FEEDS:
        req = urllib.request.Request(
            feed["url"],
            headers={"User-Agent": "Mozilla/5.0 MorningNewsSlides/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                xml_bytes = resp.read()
        except Exception as exc:
            print(f"[WARN] Failed to fetch {feed['label']}: {exc}")
            continue

        root = ET.fromstring(xml_bytes)
        items = root.findall("./channel/item")[: feed["limit"]]
        for idx, item in enumerate(items):
            raw_title = (item.findtext("title") or "").strip()
            source_el = item.find("source")
            source_name = source_el.text.strip() if source_el is not None and source_el.text else feed["label"]

            clean_title = raw_title
            m = re.match(r"^(.*)\s+-\s+([^-]+)$", raw_title)
            if m:
                clean_title = m.group(1).strip()
                if not source_name:
                    source_name = m.group(2).strip()

            desc = clean_html(item.findtext("description"))
            if len(desc) < 15:
                desc = f"{clean_title} に関する最新報道です。"
            elif len(desc) > 160:
                desc = desc[:157] + "..."

            pub_raw = item.findtext("pubDate") or ""
            pub_str = datetime.datetime.now(JST).strftime("%Y-%m-%d")
            if pub_raw:
                try:
                    dt = datetime.datetime.strptime(pub_raw, "%a, %d %b %Y %H:%M:%S %Z")
                    pub_str = dt.replace(tzinfo=datetime.timezone.utc).astimezone(JST).strftime("%Y-%m-%d %H:%M")
                except Exception:
                    pass

            img_path = feed["images"][idx % len(feed["images"])]
            collected.append(
                {
                    "category": feed["category"],
                    "category_label": feed["label"],
                    "title": clean_title,
                    "source": source_name,
                    "publishedAt": pub_str,
                    "image": img_path,
                    "summary": desc,
                    "points": [
                        f"カテゴリ: {feed['label']} の注目ニュース",
                        f"報道元: {source_name} ({pub_str})",
                        "詳細は下部のリンクから元記事を確認できます",
                    ],
                    "impact": f"{feed['label']}分野での重要トピックとして注目されています。",
                    "tags": [feed["label"], source_name],
                    "url": (item.findtext("link") or "").strip(),
                }
            )
    return collected


def enrich_with_gemini(items: list[dict], api_key: str) -> tuple[list[dict], list[str]] | None:
    prompt_articles = [
        {
            "index": i,
            "category": it["category_label"],
            "title": it["title"],
            "source": it["source"],
            "snippet": it["summary"],
        }
        for i, it in enumerate(items)
    ]

    prompt = (
        "あなたは朝のニュース番組の構成作家です。以下の最新ニュースリストをもとに、"
        "忙しい朝にスライドでサッと理解できる日本語の要約JSONを作成してください。\n\n"
        "出力は必ず以下のJSON形式のみ（マークダウンのコードブロック不要）で返してください:\n"
        "{\n"
        '  "keywords": ["注目キーワード1", "注目キーワード2", "注目キーワード3", "注目キーワード4", "注目キーワード5"],\n'
        '  "articles": [\n'
        "    {\n"
        '      "index": 0,\n'
        '      "title": "分かりやすく整えた見出し（35文字前後）",\n'
        '      "summary": "2文程度の簡潔なリード文（100文字前後）",\n'
        '      "points": ["要点1（簡潔に）", "要点2（簡潔に）", "要点3（簡潔に）"],\n'
        '      "impact": "ビジネスや生活への注目ポイント・影響（70文字前後）",\n'
        '      "tags": ["タグ1", "タグ2", "タグ3"]\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        f"入力ニュース:\n{json.dumps(prompt_articles, ensure_ascii=False, indent=2)}"
    )

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={api_key}"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
        text = res_json["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except Exception as exc:
        print(f"[WARN] Gemini API enrichment failed, using RSS fallback: {exc}")
        return None

    enriched_map = {a.get("index"): a for a in parsed.get("articles", []) if isinstance(a, dict)}
    for i, item in enumerate(items):
        ai = enriched_map.get(i)
        if not ai:
            continue
        item["title"] = ai.get("title") or item["title"]
        item["summary"] = ai.get("summary") or item["summary"]
        if isinstance(ai.get("points"), list) and len(ai["points"]) > 0:
            item["points"] = [str(p) for p in ai["points"][:3]]
        item["impact"] = ai.get("impact") or item["impact"]
        if isinstance(ai.get("tags"), list) and len(ai["tags"]) > 0:
            item["tags"] = [str(t) for t in ai["tags"][:3]]

    keywords = [str(k) for k in parsed.get("keywords", [])[:5]]
    return items, keywords


def main() -> None:
    now = datetime.datetime.now(JST)
    items = fetch_rss_items()
    if not items:
        raise RuntimeError("ニュースを1件も取得できませんでした。")

    keywords = [
        (it["title"][:16] + "…") if len(it["title"]) > 16 else it["title"]
        for it in items[:5]
    ]

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        print("GEMINI_API_KEY detected. Enriching news with Gemini API...")
        enriched = enrich_with_gemini(items, api_key)
        if enriched:
            items, ai_keywords = enriched
            if ai_keywords:
                keywords = ai_keywords
    else:
        print("GEMINI_API_KEY not set. Using RSS summary fallback.")

    clean_items = []
    for it in items:
        clean_items.append(
            {
                "category": it["category"],
                "title": it["title"],
                "source": it["source"],
                "publishedAt": it["publishedAt"],
                "image": it["image"],
                "summary": it["summary"],
                "points": it["points"],
                "impact": it["impact"],
                "tags": it["tags"],
                "url": it["url"],
            }
        )

    dow = DOW_JP[now.weekday()]
    payload = {
        "date": f"{now.year}年{now.month}月{now.day}日 ({dow})",
        "updatedAt": now.strftime("%Y-%m-%d %H:%M"),
        "title": "今日のトレンドニュース ブリーフィング",
        "keywords": keywords,
        "items": clean_items,
    }

    DATA_JS_PATH.parent.mkdir(parents=True, exist_ok=True)
    js_content = f"window.NEWS_DATA = {json.dumps(payload, ensure_ascii=False, indent=2)};\n"
    DATA_JS_PATH.write_text(js_content, encoding="utf-8")
    print(f"Updated {len(clean_items)} news items -> {DATA_JS_PATH}")


if __name__ == "__main__":
    main()

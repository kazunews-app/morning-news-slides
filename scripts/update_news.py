#!/usr/bin/env python3
"""
1時間ごとにトレンドニュースを複数ソース（Google News / はてなブックマークIT / Zenn）から収集し、
OGP画像抽出および Gemini API 要約（GEMINI_API_KEY 設定時）を行って data/news.js を更新します。
Python 標準ライブラリのみで動作します。
"""

from __future__ import annotations

import concurrent.futures
import datetime
import email.utils
import html
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

JST = datetime.timezone(datetime.timedelta(hours=9))
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_JS_PATH = PROJECT_ROOT / "data" / "news.js"

DOW_JP = ["月", "火", "水", "木", "金", "土", "日"]
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

FALLBACK_IMAGES = {
    "domestic": ["assets/images/news-1.jpg", "assets/images/news-2.jpg"],
    "tech": ["assets/images/news-3.jpg", "assets/images/news-4.jpg"],
    "business": ["assets/images/news-5.jpg", "assets/images/news-6.jpg"],
}

CATEGORY_LABELS = {
    "domestic": "国内・総合",
    "tech": "テクノロジー・AI",
    "business": "ビジネス・経済",
}


def clean_html(raw: str | None) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def find_child_text(elem: ET.Element, name: str) -> str:
    for child in elem:
        if local_name(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def parse_datetime_ts(date_str: str) -> tuple[int, str]:
    now = datetime.datetime.now(JST)
    if not date_str:
        return int(now.timestamp()), now.strftime("%Y-%m-%d %H:%M")
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        dt_jst = dt.astimezone(JST)
        return int(dt_jst.timestamp()), dt_jst.strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    try:
        dt = datetime.datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=JST)
        dt_jst = dt.astimezone(JST)
        return int(dt_jst.timestamp()), dt_jst.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return int(now.timestamp()), now.strftime("%Y-%m-%d %H:%M")


def fetch_url_bytes(url: str, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_google_news(url: str, category: str, limit: int) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(url))
    except Exception as exc:
        print(f"[WARN] Google News fetch failed ({category}): {exc}")
        return items

    for idx, node in enumerate(root.findall("./channel/item")[:limit]):
        raw_title = (node.findtext("title") or "").strip()
        source_el = node.find("source")
        source_name = (
            source_el.text.strip()
            if source_el is not None and source_el.text
            else CATEGORY_LABELS[category]
        )

        title = raw_title
        m = re.match(r"^(.*)\s+-\s+([^-]+)$", raw_title)
        if m:
            title = m.group(1).strip()
            if not source_name:
                source_name = m.group(2).strip()

        desc = clean_html(node.findtext("description"))
        if len(desc) < 15:
            desc = f"{title} に関する最新ニュースです。"
        elif len(desc) > 150:
            desc = desc[:147] + "..."

        ts, pub_str = parse_datetime_ts(node.findtext("pubDate") or "")
        link = (node.findtext("link") or "").strip()
        fb_list = FALLBACK_IMAGES[category]

        items.append(
            {
                "category": category,
                "title": title,
                "source": source_name,
                "publishedAt": pub_str,
                "publishedTs": ts,
                "image": fb_list[idx % len(fb_list)],
                "hasRealImage": False,
                "summary": desc,
                "points": [
                    f"カテゴリ: {CATEGORY_LABELS[category]}の主要トピック",
                    f"配信元: {source_name}（{pub_str}）",
                    "「元記事を読む」から詳細を確認できます",
                ],
                "impact": f"{CATEGORY_LABELS[category]}分野で注目を集めている最新トピックです。",
                "tags": [CATEGORY_LABELS[category], source_name],
                "url": link,
                "isAiEnriched": False,
            }
        )
    return items


def fetch_hatena_tech(limit: int = 3) -> list[dict]:
    url = "https://b.hatena.ne.jp/hotentry/it.rss"
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(url))
    except Exception as exc:
        print(f"[WARN] Hatena IT fetch failed: {exc}")
        return items

    rdf_items = [el for el in root if local_name(el.tag) == "item"]
    for idx, node in enumerate(rdf_items[:limit]):
        title = find_child_text(node, "title")
        link = find_child_text(node, "link")
        desc = clean_html(find_child_text(node, "description"))
        if len(desc) < 15:
            desc = f"はてなブックマーク ITカテゴリで話題の記事「{title}」です。"
        elif len(desc) > 150:
            desc = desc[:147] + "..."

        date_raw = find_child_text(node, "date")
        ts, pub_str = parse_datetime_ts(date_raw)

        img_url = find_child_text(node, "imageurl")
        has_real = bool(img_url.startswith("https://"))
        fb_list = FALLBACK_IMAGES["tech"]

        items.append(
            {
                "category": "tech",
                "title": title,
                "source": "はてブIT",
                "publishedAt": pub_str,
                "publishedTs": ts,
                "image": img_url if has_real else fb_list[idx % len(fb_list)],
                "hasRealImage": has_real,
                "summary": desc,
                "points": [
                    "エンジニア・テック界隈で注目を集めている人気記事",
                    f"配信: はてなブックマーク テクノロジー（{pub_str}）",
                    "「元記事を読む」から本文を確認できます",
                ],
                "impact": "技術トレンドや開発ノウハウとしてSNS・コミュニティで広く共有されています。",
                "tags": ["テックトレンド", "はてブIT"],
                "url": link,
                "isAiEnriched": False,
            }
        )
    return items


def fetch_zenn_tech(limit: int = 2) -> list[dict]:
    items: list[dict] = []
    try:
        data = json.loads(fetch_url_bytes("https://zenn.dev/api/articles?order=trend&count=5").decode("utf-8"))
        for idx, art in enumerate(data.get("articles", [])[:limit]):
            title = art.get("title", "").strip()
            path = art.get("path", "")
            link = f"https://zenn.dev{path}" if path.startswith("/") else "https://zenn.dev"
            ts, pub_str = parse_datetime_ts(art.get("published_at") or "")
            likes = art.get("liked_count", 0)
            user_name = (art.get("user") or {}).get("name") or "Zenn"
            fb_list = FALLBACK_IMAGES["tech"]

            items.append(
                {
                    "category": "tech",
                    "title": title,
                    "source": f"Zenn ({user_name})",
                    "publishedAt": pub_str,
                    "publishedTs": ts,
                    "image": fb_list[idx % len(fb_list)],
                    "hasRealImage": False,
                    "summary": f"Zennでトレンド入りしている技術記事（いいね {likes}件）。実務に役立つ開発知見が解説されています。",
                    "points": [
                        f"Zenn トレンド記事（いいね {likes}件）",
                        f"著者: {user_name}（{pub_str}）",
                        "「元記事を読む」からコード例や解説を確認できます",
                    ],
                    "impact": "国内のエンジニアコミュニティで話題になっている実践的なテック記事です。",
                    "tags": ["Zenn", "エンジニア", "トレンド"],
                    "url": link,
                    "isAiEnriched": False,
                }
            )
    except Exception as exc:
        print(f"[WARN] Zenn fetch failed: {exc}")
    return items


def extract_og_image(url: str) -> str | None:
    if not url or "news.google.com" in url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=3) as resp:
            ctype = resp.headers.get("Content-Type", "")
            if "html" not in ctype.lower():
                return None
            chunk = resp.read(65536).decode("utf-8", errors="ignore")
        patterns = [
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        ]
        for pat in patterns:
            m = re.search(pat, chunk, re.IGNORECASE)
            if m:
                img = html.unescape(m.group(1).strip())
                if img.startswith("https://"):
                    return img
    except Exception:
        return None
    return None


def enrich_images_parallel(items: list[dict]) -> None:
    targets = [it for it in items if not it.get("hasRealImage") and it.get("url") and "news.google.com" not in it["url"]]
    if not targets:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {pool.submit(extract_og_image, it["url"]): it for it in targets}
        for future in concurrent.futures.as_completed(future_map):
            it = future_map[future]
            try:
                og_img = future.result()
                if og_img:
                    it["image"] = og_img
                    it["hasRealImage"] = True
            except Exception:
                pass


def load_cached_items() -> dict[str, dict]:
    if not DATA_JS_PATH.exists():
        return {}
    try:
        raw = DATA_JS_PATH.read_text(encoding="utf-8")
        prefix = "window.NEWS_DATA ="
        idx = raw.find(prefix)
        if idx == -1:
            return {}
        json_part = raw[idx + len(prefix) :].strip().rstrip(";")
        data = json.loads(json_part)
        cache: dict[str, dict] = {}
        for it in data.get("items", []):
            if it.get("url"):
                cache[it["url"]] = it
            if it.get("title"):
                cache[it["title"]] = it
        return cache
    except Exception:
        return {}


def enrich_with_gemini(items: list[dict], api_key: str) -> list[str] | None:
    targets = [(i, it) for i, it in enumerate(items) if not it.get("isAiEnriched")]
    if not targets:
        return None

    prompt_articles = [
        {
            "index": i,
            "category": CATEGORY_LABELS.get(it["category"], "ニュース"),
            "title": it["title"],
            "source": it["source"],
            "snippet": it["summary"],
        }
        for i, it in targets
    ]

    prompt = (
        "あなたはニュースメディアの編集者です。以下の最新ニュースリストをもとに、"
        "ニュースサイトで読みやすい日本語の要約JSONを作成してください。\n\n"
        "出力は必ず以下のJSON形式のみ（マークダウン不要）で返してください:\n"
        "{\n"
        '  "keywords": ["注目キーワード1", "注目キーワード2", "注目キーワード3", "注目キーワード4", "注目キーワード5"],\n'
        '  "articles": [\n'
        "    {\n"
        '      "index": 0,\n'
        '      "title": "元の意味を保ちつつ読みやすく整えた見出し（38文字以内）",\n'
        '      "summary": "記事の概要を伝える簡潔なリード文（90文字前後）",\n'
        '      "points": ["要点1", "要点2", "要点3"],\n'
        '      "impact": "生活・仕事・市場への注目ポイント（70文字前後）",\n'
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
        with urllib.request.urlopen(req, timeout=50) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
        text = res_json["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except Exception as exc:
        print(f"[WARN] Gemini enrichment failed, keeping fallback: {exc}")
        return None

    ai_map = {a.get("index"): a for a in parsed.get("articles", []) if isinstance(a, dict)}
    for i, item in targets:
        ai = ai_map.get(i)
        if not ai:
            continue
        item["title"] = ai.get("title") or item["title"]
        item["summary"] = ai.get("summary") or item["summary"]
        if isinstance(ai.get("points"), list) and ai["points"]:
            item["points"] = [str(p) for p in ai["points"][:3]]
        item["impact"] = ai.get("impact") or item["impact"]
        if isinstance(ai.get("tags"), list) and ai["tags"]:
            item["tags"] = [str(t) for t in ai["tags"][:3]]
        item["isAiEnriched"] = True

    keywords = [str(k) for k in parsed.get("keywords", [])[:6] if str(k).strip()]
    return keywords or None


def interleave_top_items(domestic: list[dict], tech: list[dict], business: list[dict]) -> list[dict]:
    """トップページで各カテゴリがバランス良く並ぶように先頭を構成し、残りを時刻順にする"""
    ordered: list[dict] = []
    buckets = [list(domestic), list(tech), list(business)]
    while any(buckets):
        for b in buckets:
            if b:
                ordered.append(b.pop(0))
    return ordered


def main() -> None:
    now = datetime.datetime.now(JST)

    domestic = fetch_google_news(
        "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
        "domestic",
        limit=5,
    )
    tech = (
        fetch_google_news(
            "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja",
            "tech",
            limit=3,
        )
        + fetch_hatena_tech(limit=3)
        + fetch_zenn_tech(limit=2)
    )
    business = fetch_google_news(
        "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja",
        "business",
        limit=5,
    )

    items = interleave_top_items(domestic, tech, business)
    if not items:
        raise RuntimeError("ニュースを1件も取得できませんでした。")

    # 重複URL・タイトル除去
    seen: set[str] = set()
    unique_items: list[dict] = []
    for it in items:
        key = it.get("url") or it.get("title")
        if key and key not in seen:
            seen.add(key)
            unique_items.append(it)
    items = unique_items

    # 既存キャッシュからAI要約済み・OGP画像済みを引き継ぐ
    cache = load_cached_items()
    for it in items:
        cached = cache.get(it.get("url", "")) or cache.get(it.get("title", ""))
        if cached:
            if cached.get("isAiEnriched"):
                it["title"] = cached.get("title", it["title"])
                it["summary"] = cached.get("summary", it["summary"])
                it["points"] = cached.get("points", it["points"])
                it["impact"] = cached.get("impact", it["impact"])
                it["tags"] = cached.get("tags", it["tags"])
                it["isAiEnriched"] = True
            if cached.get("image", "").startswith("https://"):
                it["image"] = cached["image"]
                it["hasRealImage"] = True

    enrich_images_parallel(items)

    keywords: list[str] = []
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        ai_keywords = enrich_with_gemini(items, api_key)
        if ai_keywords:
            keywords = ai_keywords

    if not keywords:
        # タグや見出しから注目キーワードを作成
        tag_candidates: list[str] = []
        for it in items:
            for t in it.get("tags", []):
                if t not in CATEGORY_LABELS.values() and t not in tag_candidates:
                    tag_candidates.append(t)
        keywords = tag_candidates[:6] or [
            (it["title"][:14] + "…") if len(it["title"]) > 14 else it["title"]
            for it in items[:5]
        ]

    clean_items = []
    for it in items:
        clean_items.append(
            {
                "category": it["category"],
                "title": it["title"],
                "source": it["source"],
                "publishedAt": it["publishedAt"],
                "publishedTs": it["publishedTs"],
                "image": it["image"],
                "summary": it["summary"],
                "points": it["points"],
                "impact": it["impact"],
                "tags": it["tags"],
                "url": it["url"],
                "isAiEnriched": bool(it.get("isAiEnriched", False)),
            }
        )

    dow = DOW_JP[now.weekday()]
    payload = {
        "date": f"{now.year}年{now.month}月{now.day}日 ({dow})",
        "updatedAt": now.strftime("%Y-%m-%d %H:%M"),
        "title": "TREND NEWS",
        "keywords": keywords,
        "items": clean_items,
    }

    DATA_JS_PATH.parent.mkdir(parents=True, exist_ok=True)
    js_content = f"window.NEWS_DATA = {json.dumps(payload, ensure_ascii=False, indent=2)};\n"
    DATA_JS_PATH.write_text(js_content, encoding="utf-8")
    print(f"Updated {len(clean_items)} news items -> {DATA_JS_PATH}")


if __name__ == "__main__":
    main()

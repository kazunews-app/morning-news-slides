#!/usr/bin/env python3
"""
5分ごとにトレンドニュースを複数ソース（Yahoo!ニュース / はてなブックマーク / Zenn）から収集し、
引用元サイトの関連画像（OGP画像・サムネイル）および Gemini API 要約を行って data/news.js を更新します。
Python 標準ライブラリのみで動作します。
"""

from __future__ import annotations

import concurrent.futures
import datetime
import email.utils
import html
import html.parser
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

JST = datetime.timezone(datetime.timedelta(hours=9))
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_JS_PATH = PROJECT_ROOT / "data" / "news.js"

DOW_JP = ["月", "火", "水", "木", "金", "土", "日"]
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

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


class MetaTagParser(html.parser.HTMLParser):
    """HTMLの<head>内からOGP画像とdescriptionを正確に抽出するパーサー"""

    def __init__(self) -> None:
        super().__init__()
        self.og_images: list[str] = []
        self.descriptions: list[str] = []
        self.in_body = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.in_body:
            return
        t = tag.lower()
        if t == "body":
            self.in_body = True
            return
        if t != "meta":
            return

        attr_map = {k.lower(): (v or "").strip() for k, v in attrs if k}
        content = attr_map.get("content", "")
        if not content:
            return

        prop = attr_map.get("property", "").lower()
        name = attr_map.get("name", "").lower()

        if prop in ("og:image", "og:image:url", "og:image:secure_url") or name in (
            "og:image",
            "twitter:image",
            "twitter:image:src",
        ):
            self.og_images.append(content)
        elif prop == "og:description" or name in ("og:description", "description", "twitter:description"):
            self.descriptions.append(content)


def clean_html(raw: str | None) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def format_summary_text(text: str, title: str, max_len: int = 155) -> str:
    """途中切れの要約文や不自然な要約文を綺麗に整形する"""
    cleaned = clean_html(text)
    if not cleaned or len(cleaned) < 15:
        return f"「{title}」に関する注目ニュースです。詳細は元記事から確認できます。"

    if len(cleaned) > max_len:
        cleaned = cleaned[: max_len - 1].rstrip(" 、。・") + "…"
    else:
        # Yahoo!ニュース等で文の途中（数字や助詞、漢字）で切れている場合に三点リーダーを補完
        if not cleaned.endswith(("。", "！", "？", "!", "?", "）", ")", "」", "』", "…", ".")):
            cleaned = cleaned + "…"

    return cleaned


def sanitize_http_url(raw_url: str | None) -> str:
    if not raw_url:
        return ""
    u = raw_url.strip()
    if u.startswith(("https://", "http://")):
        return u
    return ""


def local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def find_child_text(elem: ET.Element, name: str) -> str:
    for child in elem:
        if local_name(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def domain_label(url: str, fallback: str) -> str:
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host or fallback
    except Exception:
        return fallback


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


def decode_html_bytes(raw_bytes: bytes, content_type_header: str = "") -> str:
    """Content-Typeやmeta charsetを考慮して文字化けなくデコードする"""
    encodings: list[str] = []
    m_ct = re.search(r"charset=([a-zA-Z0-9_\-]+)", content_type_header, re.IGNORECASE)
    if m_ct:
        encodings.append(m_ct.group(1).strip())

    head_ascii = raw_bytes[:4096].decode("ascii", errors="ignore")
    m_meta = re.search(r"charset=[\"']?([a-zA-Z0-9_\-]+)", head_ascii, re.IGNORECASE)
    if m_meta:
        encodings.append(m_meta.group(1).strip())

    encodings.extend(["utf-8", "cp932", "euc_jp"])
    for enc in encodings:
        try:
            norm_enc = "cp932" if enc.lower() in ("shift_jis", "shift-jis", "sjis", "windows-31j") else enc
            return raw_bytes.decode(norm_enc)
        except Exception:
            continue
    return raw_bytes.decode("utf-8", errors="ignore")


def fetch_url_bytes(url: str, timeout: int = 12) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def is_generic_logo_image(img_url: str) -> bool:
    lowered = img_url.lower()
    bad_tokens = [
        "ogp_default",
        "default_ogp",
        "s.yimg.jp/images/news/ogp",
        "s.yimg.jp/images/jpnews/cre/common",
        "nosimage",
        "noimage",
        "spacer.gif",
    ]
    return any(tok in lowered for tok in bad_tokens)


def normalize_image_url(base_url: str, raw_img: str) -> str | None:
    if not raw_img:
        return None
    img = html.unescape(raw_img.strip())
    if img.startswith("//"):
        img = "https:" + img
    elif img.startswith("/"):
        img = urllib.parse.urljoin(base_url, img)
    elif img.startswith("http://"):
        img = "https://" + img[len("http://") :]
    if not img.startswith("https://"):
        return None
    if is_generic_logo_image(img):
        return None
    return img


def extract_meta_from_html(page_url: str, html_text: str) -> tuple[str | None, str | None]:
    parser = MetaTagParser()
    try:
        parser.feed(html_text)
    except Exception:
        pass

    found_img: str | None = None
    for cand_raw in parser.og_images:
        cand = normalize_image_url(page_url, cand_raw)
        if cand:
            found_img = cand
            break

    if not found_img and "yahoo.co.jp" in page_url:
        m_y = re.search(r'(https://newsatcl-pctr\.c\.yimg\.jp/[^\s"\'<>]+)', html_text)
        if m_y:
            found_img = normalize_image_url(page_url, m_y.group(1))

    found_desc: str | None = None
    for d_raw in parser.descriptions:
        d = clean_html(d_raw)
        if len(d) >= 20:
            found_desc = d
            break

    return found_img, found_desc


def fetch_page_og_meta(url: str, depth: int = 0) -> tuple[str | None, str | None]:
    if not url or depth > 1:
        return None, None
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ja,en-US;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            final_url = resp.geturl() or url
            ctype = resp.headers.get("Content-Type", "")
            if "html" not in ctype.lower():
                return None, None
            raw_chunk = resp.read(131072)
        chunk = decode_html_bytes(raw_chunk, ctype)
        img, desc = extract_meta_from_html(final_url, chunk)

        if not img and "news.yahoo.co.jp/pickup/" in final_url and depth == 0:
            m_art = re.search(r'(https://news\.yahoo\.co\.jp/articles/[a-zA-Z0-9]+)', chunk)
            if m_art:
                return fetch_page_og_meta(m_art.group(1), depth=depth + 1)

        return img, desc
    except Exception:
        return None, None


def fetch_yahoo_topics(rss_url: str, category: str, limit: int) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(rss_url))
    except Exception as exc:
        print(f"[WARN] Yahoo RSS fetch failed ({category}): {exc}")
        return items

    for idx, node in enumerate(root.findall("./channel/item")[:limit]):
        title = (node.findtext("title") or "").strip()
        link = sanitize_http_url(node.findtext("link"))
        if not title or not link:
            continue
        ts, pub_str = parse_datetime_ts(node.findtext("pubDate") or "")
        rss_img = normalize_image_url(link, node.findtext("image") or "")
        fb_list = FALLBACK_IMAGES[category]

        items.append(
            {
                "category": category,
                "title": title,
                "source": "Yahoo!ニュース",
                "publishedAt": pub_str,
                "publishedTs": ts,
                "image": rss_img or fb_list[idx % len(fb_list)],
                "fallbackHatenaImg": rss_img,
                "hasRealImage": bool(rss_img),
                "summary": f"「{title}」に関する注目ニュースです。詳細は元記事から確認できます。",
                "points": [
                    f"カテゴリ: {CATEGORY_LABELS[category]}の注目トピック",
                    f"配信: Yahoo!ニュース トピックス（{pub_str}）",
                    "「元記事を読む」から詳細を確認できます",
                ],
                "impact": f"{CATEGORY_LABELS[category]}分野で関心を集めている最新ニュースです。",
                "tags": [CATEGORY_LABELS[category], "Yahoo!ニュース"],
                "url": link,
                "isAiEnriched": False,
            }
        )
    return items


def fetch_hatena_rss(rss_url: str, category: str, limit: int) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(rss_url))
    except Exception as exc:
        print(f"[WARN] Hatena RSS fetch failed ({category}): {exc}")
        return items

    rdf_items = [el for el in root if local_name(el.tag) == "item"]
    for idx, node in enumerate(rdf_items[:limit]):
        title = find_child_text(node, "title")
        link = sanitize_http_url(find_child_text(node, "link"))
        if not title or not link:
            continue
        desc = format_summary_text(find_child_text(node, "description"), title)

        date_raw = find_child_text(node, "date")
        ts, pub_str = parse_datetime_ts(date_raw)

        hatena_img = normalize_image_url(link, find_child_text(node, "imageurl"))
        fb_list = FALLBACK_IMAGES[category]
        src_domain = domain_label(link, "はてなブックマーク")

        items.append(
            {
                "category": category,
                "title": title,
                "source": src_domain,
                "publishedAt": pub_str,
                "publishedTs": ts,
                "image": hatena_img or fb_list[idx % len(fb_list)],
                "fallbackHatenaImg": hatena_img,
                "hasRealImage": False,
                "summary": desc,
                "points": [
                    f"カテゴリ: {CATEGORY_LABELS[category]}で話題の記事",
                    f"引用元: {src_domain}（{pub_str}）",
                    "「元記事を読む」から本文を確認できます",
                ],
                "impact": f"{CATEGORY_LABELS[category]}分野で多くの読者に共有されている注目記事です。",
                "tags": [CATEGORY_LABELS[category], src_domain],
                "url": link,
                "isAiEnriched": False,
            }
        )
    return items


def fetch_zenn_tech(limit: int = 4) -> list[dict]:
    items: list[dict] = []
    try:
        data = json.loads(
            fetch_url_bytes("https://zenn.dev/api/articles?order=trend&count=10").decode("utf-8")
        )
        for idx, art in enumerate(data.get("articles", [])[:limit]):
            title = (art.get("title") or "").strip()
            path = art.get("path") or ""
            link = f"https://zenn.dev{path}" if path.startswith("/") else "https://zenn.dev"
            if not title:
                continue
            ts, pub_str = parse_datetime_ts(art.get("published_at") or "")
            likes = art.get("liked_count", 0)
            user_name = (art.get("user") or {}).get("name") or "Zenn"
            fb_list = FALLBACK_IMAGES["tech"]

            items.append(
                {
                    "category": "tech",
                    "title": title,
                    "source": f"zenn.dev ({user_name})",
                    "publishedAt": pub_str,
                    "publishedTs": ts,
                    "image": fb_list[idx % len(fb_list)],
                    "fallbackHatenaImg": None,
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


def enrich_og_metadata_parallel(items: list[dict]) -> None:
    targets = [it for it in items if not it.get("hasRealImage") and it.get("url")]
    if not targets:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {pool.submit(fetch_page_og_meta, it["url"]): it for it in targets}
        for future in concurrent.futures.as_completed(future_map):
            it = future_map[future]
            try:
                og_img, og_desc = future.result()
                if og_img:
                    it["image"] = og_img
                    it["hasRealImage"] = True
                elif it.get("fallbackHatenaImg"):
                    it["image"] = it["fallbackHatenaImg"]
                    it["hasRealImage"] = True

                # 初期プレースホルダー文のときのみページ側のog:descriptionを採用
                if og_desc and "に関する注目ニュースです" in it.get("summary", ""):
                    it["summary"] = format_summary_text(og_desc, it["title"])
            except Exception:
                if it.get("fallbackHatenaImg"):
                    it["image"] = it["fallbackHatenaImg"]
                    it["hasRealImage"] = True


def load_cached_data() -> tuple[dict[str, dict], list[str]]:
    if not DATA_JS_PATH.exists():
        return {}, []
    try:
        raw = DATA_JS_PATH.read_text(encoding="utf-8")
        prefix = "window.NEWS_DATA ="
        idx = raw.find(prefix)
        if idx == -1:
            return {}, []
        json_part = raw[idx + len(prefix) :].strip().rstrip(";")
        data = json.loads(json_part)
        cache: dict[str, dict] = {}
        for it in data.get("items", []):
            if it.get("url"):
                cache[it["url"]] = it
        cached_kw = [str(k) for k in data.get("keywords", []) if str(k).strip()]
        return cache, cached_kw
    except Exception:
        return {}, []


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
        '      "summary": "記事の概要を伝える完結したリード文（90文字前後）",\n'
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
    ordered: list[dict] = []
    buckets = [list(domestic), list(tech), list(business)]
    while any(buckets):
        for b in buckets:
            if b:
                ordered.append(b.pop(0))
    return ordered


def pick_unique_category_items(
    candidates: list[dict], seen: set[str], target_count: int = 10
) -> list[dict]:
    picked: list[dict] = []
    for it in candidates:
        key_url = it.get("url", "").strip()
        key_title = it.get("title", "").strip()
        if not key_title or (key_url and key_url in seen) or key_title in seen:
            continue
        if key_url:
            seen.add(key_url)
        seen.add(key_title)
        picked.append(it)
        if len(picked) >= target_count:
            break
    return picked


def main() -> None:
    now = datetime.datetime.now(JST)

    domestic_candidates = (
        fetch_yahoo_topics("https://news.yahoo.co.jp/rss/topics/domestic.xml", "domestic", limit=6)
        + fetch_hatena_rss("https://b.hatena.ne.jp/hotentry/social.rss", "domestic", limit=8)
        + fetch_yahoo_topics("https://news.yahoo.co.jp/rss/topics/top-picks.xml", "domestic", limit=5)
    )

    tech_candidates = (
        fetch_yahoo_topics("https://news.yahoo.co.jp/rss/topics/it.xml", "tech", limit=5)
        + fetch_hatena_rss("https://b.hatena.ne.jp/hotentry/it.rss", "tech", limit=8)
        + fetch_zenn_tech(limit=4)
    )

    business_candidates = (
        fetch_yahoo_topics("https://news.yahoo.co.jp/rss/topics/business.xml", "business", limit=6)
        + fetch_hatena_rss("https://b.hatena.ne.jp/hotentry/economics.rss", "business", limit=8)
    )

    seen_global: set[str] = set()
    domestic = pick_unique_category_items(domestic_candidates, seen_global, target_count=10)
    tech = pick_unique_category_items(tech_candidates, seen_global, target_count=10)
    business = pick_unique_category_items(business_candidates, seen_global, target_count=10)

    items = interleave_top_items(domestic, tech, business)
    if not items:
        raise RuntimeError("ニュースを1件も取得できませんでした。")

    # 既存キャッシュからAI要約・実画像を引き継ぐ
    cache, cached_keywords = load_cached_data()
    for it in items:
        cached = cache.get(it.get("url", ""))
        if cached:
            if cached.get("isAiEnriched"):
                it["title"] = cached.get("title", it["title"])
                it["summary"] = format_summary_text(cached.get("summary", it["summary"]), it["title"])
                it["points"] = cached.get("points", it["points"])
                it["impact"] = cached.get("impact", it["impact"])
                it["tags"] = cached.get("tags", it["tags"])
                it["isAiEnriched"] = True
            elif cached.get("summary") and "に関する注目ニュースです" not in cached.get("summary", ""):
                it["summary"] = format_summary_text(cached["summary"], it["title"])

            cached_img = cached.get("image", "")
            if cached_img.startswith("https://") and not is_generic_logo_image(cached_img):
                it["image"] = cached_img
                it["hasRealImage"] = True

    # 引用元ページからOGP画像＆概要を並列取得
    enrich_og_metadata_parallel(items)

    keywords: list[str] = []
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        ai_keywords = enrich_with_gemini(items, api_key)
        if ai_keywords:
            keywords = ai_keywords
        elif cached_keywords:
            keywords = cached_keywords

    if not keywords:
        keywords = [
            (it["title"][:13] + "…") if len(it["title"]) > 13 else it["title"]
            for it in items[:6]
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
                "summary": format_summary_text(it["summary"], it["title"]),
                "points": it["points"],
                "impact": it["impact"],
                "tags": it["tags"],
                "url": sanitize_http_url(it["url"]),
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
    real_img_count = sum(1 for it in clean_items if it["image"].startswith("https://"))
    print(
        f"Updated {len(clean_items)} news items ({real_img_count} with source images) -> {DATA_JS_PATH}"
    )


if __name__ == "__main__":
    main()

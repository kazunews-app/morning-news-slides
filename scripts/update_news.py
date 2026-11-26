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
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

JST = datetime.timezone(datetime.timedelta(hours=9))
MAX_ARTICLE_AGE_SECONDS = 24 * 3600
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_JS_PATH = PROJECT_ROOT / "data" / "news.js"

DOW_JP = ["月", "火", "水", "木", "金", "土", "日"]
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

CATEGORY_LABELS = {
    "domestic": "国内・総合",
    "tech": "テクノロジー・AI",
    "business": "ビジネス・経済",
    "entertainment": "芸能・エンタメ",
    "subculture": "サブカルチャー",
}


class MetaTagParser(html.parser.HTMLParser):
    """HTML内のOGP画像・JSON-LD画像・記事本文内画像・descriptionを抽出するパーサー"""

    def __init__(self) -> None:
        super().__init__()
        self.og_images: list[str] = []
        self.article_images: list[str] = []
        self.other_images: list[str] = []
        self.ld_json_blocks: list[str] = []
        self.descriptions: list[str] = []
        self.in_ld_json = False
        self.ld_buf: list[str] = []
        self.article_depth = 0
        self.skip_container_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        attr_map = {k.lower(): (v or "").strip() for k, v in attrs if k}

        if t in ("article", "main"):
            self.article_depth += 1
        elif t in ("header", "footer", "nav", "aside"):
            self.skip_container_depth += 1

        if t == "script":
            stype = attr_map.get("type", "").lower()
            if "ld+json" in stype:
                self.in_ld_json = True
                self.ld_buf = []
            return

        if t == "meta":
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
            return

        if t == "link":
            rel = attr_map.get("rel", "").lower()
            href = attr_map.get("href", "")
            if href and "image_src" in rel:
                self.og_images.append(href)
            return

        if t == "img" and self.skip_container_depth == 0:
            src = (
                attr_map.get("data-src")
                or attr_map.get("data-lazy-src")
                or attr_map.get("data-original")
                or attr_map.get("src")
                or ""
            )
            if not src:
                return
            cls_alt = (attr_map.get("class", "") + " " + attr_map.get("alt", "")).lower()
            if any(k in cls_alt for k in ("icon", "logo", "avatar", "emoji", "badge", "banner", "button")):
                return
            w_raw = attr_map.get("width", "")
            h_raw = attr_map.get("height", "")
            try:
                if (w_raw and int(re.sub(r"\D", "", w_raw) or "999") < 64) or (
                    h_raw and int(re.sub(r"\D", "", h_raw) or "999") < 64
                ):
                    return
            except ValueError:
                pass
            if self.article_depth > 0:
                self.article_images.append(src)
            else:
                self.other_images.append(src)

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t == "script" and self.in_ld_json:
            self.in_ld_json = False
            raw = "".join(self.ld_buf).strip()
            if raw:
                self.ld_json_blocks.append(raw)
            self.ld_buf = []
        elif t in ("article", "main") and self.article_depth > 0:
            self.article_depth -= 1
        elif t in ("header", "footer", "nav", "aside") and self.skip_container_depth > 0:
            self.skip_container_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.in_ld_json:
            self.ld_buf.append(data)


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
    if not date_str:
        return 0, ""
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
        return 0, ""


def is_within_24h(published_ts: int, now_ts: int | None = None) -> bool:
    if now_ts is None:
        now_ts = int(datetime.datetime.now(JST).timestamp())
    age = now_ts - published_ts
    return published_ts > 0 and -3600 <= age < MAX_ARTICLE_AGE_SECONDS


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
        "assets/images/",
        "ogp_default",
        "default_ogp",
        "s.yimg.jp/images/news/ogp",
        "s.yimg.jp/images/jpnews/cre/common",
        "nosimage",
        "noimage",
        "no_image",
        "spacer.gif",
        "1x1.",
        "pixel.gif",
        "favicon",
        "apple-touch-icon",
        "b.hatena.ne.jp/images/",
        "/common/img/logo",
        "/assets/logo",
        "default.jpg",
        "default.png",
        "amd-img/default",
        ".svg",
    ]
    return any(tok in lowered for tok in bad_tokens)


def normalize_image_url(base_url: str, raw_img: str) -> str | None:
    if not raw_img:
        return None
    img = html.unescape(raw_img.strip())
    if img.startswith("data:"):
        return None
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


def build_related_web_image_url(title: str, category: str = "") -> str:
    """記事タイトル・カテゴリからネット上の最も関連性の高い画像URLを生成する"""
    cleaned = re.sub(r"【[^】]*】|\[[^\]]*\]|［[^］]*］|（[^）]*）|\([^)]*\)", " ", title or "")
    cleaned = re.sub(r"\s*[-|｜–—]\s*[^-|｜–—]+$", "", cleaned)
    cleaned = re.sub(r"[「」『』！？!?,、。・…\"'#@]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    words = cleaned[:40].strip()
    if len(words) < 4:
        words = CATEGORY_LABELS.get(category, "日本 ニュース")
    return (
        "https://tse2.mm.bing.net/th?q="
        + urllib.parse.quote(words)
        + "&w=800&h=450&c=7&rs=1&p=0"
    )


def _extract_images_from_ld_json(raw_json: str) -> list[str]:
    found: list[str] = []
    try:
        parsed = json.loads(raw_json)
    except Exception:
        return found

    def walk(obj: object) -> None:
        if isinstance(obj, dict):
            for key in ("image", "thumbnailUrl"):
                val = obj.get(key)
                if isinstance(val, str):
                    found.append(val)
                elif isinstance(val, dict) and isinstance(val.get("url"), str):
                    found.append(val["url"])
                elif isinstance(val, list):
                    for sub in val:
                        if isinstance(sub, str):
                            found.append(sub)
                        elif isinstance(sub, dict) and isinstance(sub.get("url"), str):
                            found.append(sub["url"])
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(parsed)
    return found


def extract_meta_from_html(page_url: str, html_text: str) -> tuple[str | None, str | None]:
    parser = MetaTagParser()
    try:
        parser.feed(html_text)
    except Exception:
        pass

    candidates: list[str] = list(parser.og_images)
    for raw_ld in parser.ld_json_blocks:
        candidates.extend(_extract_images_from_ld_json(raw_ld))
    candidates.extend(parser.article_images)
    candidates.extend(parser.other_images)

    found_img: str | None = None
    for cand_raw in candidates:
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


def extract_image_from_rss_node(node: ET.Element, link: str, extra_html: str = "") -> str | None:
    """RSS/Atomノード内のmedia:thumbnail / media:content / enclosure / HTML imgから画像を抽出"""
    for child in node:
        lname = local_name(child.tag)
        if lname in ("thumbnail", "content", "enclosure"):
            url_attr = child.attrib.get("url") or child.attrib.get("href") or ""
            typ = child.attrib.get("type", "").lower()
            if url_attr and (not typ or typ.startswith("image/") or lname in ("thumbnail", "content")):
                norm = normalize_image_url(link, url_attr)
                if norm:
                    return norm
        elif lname in ("image", "imageurl") and child.text:
            norm = normalize_image_url(link, child.text)
            if norm:
                return norm

    if extra_html:
        for m in re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', extra_html, re.IGNORECASE):
            norm = normalize_image_url(link, m.group(1))
            if norm:
                return norm
    return None


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

        if (not img or not desc) and "news.yahoo.co.jp/pickup/" in final_url and depth == 0:
            m_art = re.search(r'(https://news\.yahoo\.co\.jp/articles/[a-zA-Z0-9]+)', chunk)
            if m_art:
                art_img, art_desc = fetch_page_og_meta(m_art.group(1), depth=depth + 1)
                img = img or art_img
                desc = desc or art_desc

        return img, desc
    except Exception:
        return None, None


def fetch_yahoo_topics(rss_url: str, category: str, limit: int, now_ts: int | None = None) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(rss_url))
    except Exception as exc:
        print(f"[WARN] Yahoo RSS fetch failed ({category}): {exc}")
        return items

    for node in root.findall("./channel/item")[:limit]:
        title = (node.findtext("title") or "").strip()
        link = sanitize_http_url(node.findtext("link"))
        if not title or not link:
            continue
        ts, pub_str = parse_datetime_ts(node.findtext("pubDate") or "")
        if not is_within_24h(ts, now_ts):
            continue
        rss_img = extract_image_from_rss_node(node, link, node.findtext("description") or "")

        items.append(
            {
                "category": category,
                "title": title,
                "source": "Yahoo!ニュース",
                "publishedAt": pub_str,
                "publishedTs": ts,
                "image": rss_img or build_related_web_image_url(title, category),
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


def fetch_hatena_rss(rss_url: str, category: str, limit: int, now_ts: int | None = None) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(rss_url))
    except Exception as exc:
        print(f"[WARN] Hatena RSS fetch failed ({category}): {exc}")
        return items

    rdf_items = [el for el in root if local_name(el.tag) == "item"]
    for node in rdf_items[:limit]:
        title = find_child_text(node, "title")
        link = sanitize_http_url(find_child_text(node, "link"))
        if not title or not link:
            continue

        date_raw = find_child_text(node, "date")
        ts, pub_str = parse_datetime_ts(date_raw)
        if not is_within_24h(ts, now_ts):
            continue

        raw_desc = find_child_text(node, "description")
        raw_encoded = find_child_text(node, "encoded")
        desc = format_summary_text(raw_desc, title)

        hatena_img = extract_image_from_rss_node(node, link, f"{raw_encoded}\n{raw_desc}")
        src_domain = domain_label(link, "はてなブックマーク")

        items.append(
            {
                "category": category,
                "title": title,
                "source": src_domain,
                "publishedAt": pub_str,
                "publishedTs": ts,
                "image": hatena_img or build_related_web_image_url(title, category),
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


def fetch_zenn_tech(limit: int = 20, now_ts: int | None = None) -> list[dict]:
    items: list[dict] = []
    try:
        data = json.loads(
            fetch_url_bytes("https://zenn.dev/api/articles?order=trend&count=30").decode("utf-8")
        )
        for art in data.get("articles", [])[:limit]:
            title = (art.get("title") or "").strip()
            path = art.get("path") or ""
            link = f"https://zenn.dev{path}" if path.startswith("/") else "https://zenn.dev"
            if not title:
                continue
            ts, pub_str = parse_datetime_ts(art.get("published_at") or "")
            if not is_within_24h(ts, now_ts):
                continue
            likes = art.get("liked_count", 0)
            user_name = (art.get("user") or {}).get("name") or "Zenn"

            items.append(
                {
                    "category": "tech",
                    "title": title,
                    "source": f"zenn.dev ({user_name})",
                    "publishedAt": pub_str,
                    "publishedTs": ts,
                    "image": build_related_web_image_url(title, "tech"),
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


def fetch_generic_feed(
    feed_url: str,
    category: str,
    source_label: str,
    limit: int = 20,
    extra_tag: str = "",
    now_ts: int | None = None,
) -> list[dict]:
    """RSS 2.0 および Atom フィードから記事を取得する"""
    items: list[dict] = []
    try:
        root = ET.fromstring(fetch_url_bytes(feed_url))
    except Exception as exc:
        print(f"[WARN] Feed fetch failed ({source_label}): {exc}")
        return items

    root_name = local_name(root.tag)
    cat_label = CATEGORY_LABELS[category]

    if root_name == "feed":
        # Atom feed (例: コミックナタリー)
        entries = [el for el in root if local_name(el.tag) == "entry"][:limit]
        for entry in entries:
            title = find_child_text(entry, "title")
            link = ""
            for child in entry:
                if local_name(child.tag) == "link":
                    href = child.attrib.get("href", "")
                    rel = child.attrib.get("rel", "alternate")
                    if href and rel in ("alternate", ""):
                        link = sanitize_http_url(href)
                        break
            if not title or not link:
                continue
            date_raw = find_child_text(entry, "published") or find_child_text(entry, "updated")
            ts, pub_str = parse_datetime_ts(date_raw)
            if not is_within_24h(ts, now_ts):
                continue
            summary_raw = find_child_text(entry, "summary") or find_child_text(entry, "content")
            desc = format_summary_text(summary_raw, title)
            rss_img = extract_image_from_rss_node(entry, link, summary_raw)
            tags = [t for t in [cat_label, extra_tag, source_label] if t][:3]

            items.append(
                {
                    "category": category,
                    "title": title,
                    "source": source_label,
                    "publishedAt": pub_str,
                    "publishedTs": ts,
                    "image": rss_img or build_related_web_image_url(title, category),
                    "fallbackHatenaImg": rss_img,
                    "hasRealImage": False,
                    "summary": desc,
                    "points": [
                        f"カテゴリ: {cat_label}の注目ニュース",
                        f"配信: {source_label}（{pub_str}）",
                        "「元記事を読む」から詳細を確認できます",
                    ],
                    "impact": f"{cat_label}分野で注目を集めている最新記事です。",
                    "tags": tags,
                    "url": link,
                    "isAiEnriched": False,
                }
            )
    else:
        # RSS 2.0 (例: AUTOMATON, PANORA)
        rss_items = root.findall("./channel/item")[:limit]
        for node in rss_items:
            title = (node.findtext("title") or "").strip()
            link = sanitize_http_url(node.findtext("link"))
            if not title or not link:
                continue
            date_raw = node.findtext("pubDate") or find_child_text(node, "date")
            ts, pub_str = parse_datetime_ts(date_raw)
            if not is_within_24h(ts, now_ts):
                continue
            raw_desc = node.findtext("description") or ""
            raw_encoded = find_child_text(node, "encoded")
            desc = format_summary_text(raw_desc, title)
            rss_img = extract_image_from_rss_node(node, link, f"{raw_encoded}\n{raw_desc}")
            tags = [t for t in [cat_label, extra_tag, source_label] if t][:3]

            items.append(
                {
                    "category": category,
                    "title": title,
                    "source": source_label,
                    "publishedAt": pub_str,
                    "publishedTs": ts,
                    "image": rss_img or build_related_web_image_url(title, category),
                    "fallbackHatenaImg": rss_img,
                    "hasRealImage": False,
                    "summary": desc,
                    "points": [
                        f"カテゴリ: {cat_label}の注目ニュース",
                        f"配信: {source_label}（{pub_str}）",
                        "「元記事を読む」から詳細を確認できます",
                    ],
                    "impact": f"{cat_label}分野で注目を集めている最新記事です。",
                    "tags": tags,
                    "url": link,
                    "isAiEnriched": False,
                }
            )
    return items


def enrich_og_metadata_parallel(items: list[dict]) -> None:
    targets = [
        it
        for it in items
        if (not it.get("hasRealImage") or "に関する注目ニュースです" in it.get("summary", ""))
        and it.get("url")
    ]
    if not targets:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        future_map = {pool.submit(fetch_page_og_meta, it["url"]): it for it in targets}
        for future in concurrent.futures.as_completed(future_map):
            it = future_map[future]
            try:
                og_img, og_desc = future.result()
                if og_img and not is_generic_logo_image(og_img):
                    it["image"] = og_img
                    it["hasRealImage"] = True
                elif it.get("fallbackHatenaImg") and not is_generic_logo_image(it["fallbackHatenaImg"]):
                    it["image"] = it["fallbackHatenaImg"]
                    it["hasRealImage"] = True

                # 初期プレースホルダー文のときのみページ側のog:descriptionを採用
                if og_desc and "に関する注目ニュースです" in it.get("summary", ""):
                    it["summary"] = format_summary_text(og_desc, it["title"])
            except Exception:
                fb_img = it.get("fallbackHatenaImg") or ""
                if fb_img and not is_generic_logo_image(fb_img):
                    it["image"] = fb_img
                    it["hasRealImage"] = True


def load_cached_data(now_ts: int | None = None) -> tuple[dict[str, dict], list[str], dict[str, dict]]:
    if not DATA_JS_PATH.exists():
        return {}, [], {}
    try:
        raw = DATA_JS_PATH.read_text(encoding="utf-8")
        prefix = "window.NEWS_DATA ="
        idx = raw.find(prefix)
        if idx == -1:
            return {}, [], {}
        json_part = raw[idx + len(prefix) :].strip().rstrip(";")
        data = json.loads(json_part)
        cache: dict[str, dict] = {}
        for it in data.get("items", []):
            ts = int(it.get("publishedTs") or 0)
            if it.get("url") and is_within_24h(ts, now_ts):
                cache[it["url"]] = it
        cached_kw = [str(k) for k in data.get("keywords", []) if str(k).strip()]
        cached_weather: dict[str, dict] = {}
        for wc in data.get("weatherCities", []):
            if isinstance(wc, dict) and wc.get("name"):
                cached_weather[wc["name"]] = wc
        return cache, cached_kw, cached_weather
    except Exception:
        return {}, [], {}


MAJOR_JP_CITIES = [
    {"name": "札幌", "region": "北海道", "lat": 43.0618, "lon": 141.3545, "jmaOffice": "016000"},
    {"name": "仙台", "region": "東北", "lat": 38.2682, "lon": 140.8694, "jmaOffice": "040000"},
    {"name": "新潟", "region": "北陸", "lat": 37.9161, "lon": 139.0364, "jmaOffice": "150000"},
    {"name": "金沢", "region": "北陸", "lat": 36.5613, "lon": 136.6562, "jmaOffice": "170000"},
    {"name": "東京", "region": "関東", "lat": 35.6812, "lon": 139.7671, "jmaOffice": "130000"},
    {"name": "名古屋", "region": "東海", "lat": 35.1815, "lon": 136.9066, "jmaOffice": "230000"},
    {"name": "大阪", "region": "近畿", "lat": 34.6937, "lon": 135.5023, "jmaOffice": "270000"},
    {"name": "広島", "region": "中国", "lat": 34.3853, "lon": 132.4553, "jmaOffice": "340000"},
    {"name": "高知", "region": "四国", "lat": 33.5597, "lon": 133.5311, "jmaOffice": "390000"},
    {"name": "福岡", "region": "九州", "lat": 33.5902, "lon": 130.4017, "jmaOffice": "400000"},
    {"name": "那覇", "region": "沖縄", "lat": 26.2124, "lon": 127.6809, "jmaOffice": "471000"},
]


def _jma_code_to_wmo(jma_code: str, weather_text: str = "") -> int:
    code = str(jma_code or "").strip()
    text = str(weather_text or "")
    if "雷" in text:
        return 95
    if text.startswith("雪") or text.startswith("みぞれ") or "吹雪" in text:
        return 71
    if text.startswith("雨"):
        return 61
    if code.startswith("4"):
        return 71
    if code.startswith("3"):
        return 61
    if code.startswith("2"):
        return 80 if "雨" in text else (71 if "雪" in text else 3)
    if code.startswith("1"):
        if code == "100":
            return 0
        if "雨" in text:
            return 80
        if "雪" in text:
            return 71
        return 1
    return 1


def _parse_int_list(values: list) -> list[int]:
    out: list[int] = []
    for v in values or []:
        s = str(v).strip()
        if not s:
            continue
        try:
            out.append(round(float(s)))
        except ValueError:
            continue
    return out


def _build_default_hourly_and_daily(
    temp: int,
    max_temp: int,
    min_temp: int,
    code: int,
    pop: int,
    now_dt: datetime.datetime | None = None,
) -> tuple[list[dict], list[dict]]:
    now = now_dt or datetime.datetime.now(JST)
    start_hour = (now.hour // 3) * 3
    hourly: list[dict] = []
    for i in range(8):
        h = (start_hour + i * 3) % 24
        # 6時頃が最低、15時頃が最高になる自然な日変化カーブ
        phase = abs(h - 14) / 12.0
        est_temp = round(max_temp - (max_temp - min_temp) * min(1.0, phase))
        hourly.append(
            {
                "time": f"{h:02d}:00",
                "code": code,
                "temp": est_temp,
                "pop": pop,
            }
        )

    daily: list[dict] = []
    for d_idx in range(7):
        dt = now + datetime.timedelta(days=d_idx)
        dow = DOW_JP[dt.weekday()]
        offset = (d_idx % 3) - 1 if d_idx > 0 else 0
        daily.append(
            {
                "date": f"{dt.month}/{dt.day}",
                "dow": "今日" if d_idx == 0 else ("明日" if d_idx == 1 else dow),
                "code": code,
                "maxTemp": max_temp + offset,
                "minTemp": min_temp + offset,
                "pop": pop,
            }
        )
    return hourly, daily


def fetch_city_weather_jma(city: dict) -> dict | None:
    office = city.get("jmaOffice")
    if not office:
        return None
    url = f"https://www.jma.go.jp/bosai/forecast/data/forecast/{office}.json"
    try:
        raw = fetch_url_bytes(url, timeout=10)
        jma_json = json.loads(raw.decode("utf-8"))
        rep = jma_json[0] if isinstance(jma_json, list) and jma_json else {}
        weekly = jma_json[1] if isinstance(jma_json, list) and len(jma_json) > 1 else {}
        ts = rep.get("timeSeries") or []
        area0 = ((ts[0].get("areas") or [{}])[0]) if len(ts) > 0 else {}
        jma_code = (area0.get("weatherCodes") or [""])[0]
        w_text = (area0.get("weathers") or [""])[0]
        wmo_code = _jma_code_to_wmo(jma_code, w_text)

        pops_raw = _parse_int_list(((ts[1].get("areas") or [{}])[0]).get("pops") if len(ts) > 1 else [])
        pop = max(pops_raw[:3]) if pops_raw else 10

        temps_raw = _parse_int_list(((ts[2].get("areas") or [{}])[0]).get("temps") if len(ts) > 2 else [])
        wk_ts = weekly.get("timeSeries") or []
        wk_area0 = ((wk_ts[0].get("areas") or [{}])[0]) if len(wk_ts) > 0 else {}
        wk_area1 = ((wk_ts[1].get("areas") or [{}])[0]) if len(wk_ts) > 1 else {}
        wk_mins = _parse_int_list(wk_area1.get("tempsMin"))
        wk_maxs = _parse_int_list(wk_area1.get("tempsMax"))

        max_temp = 18
        min_temp = 10
        if len(temps_raw) >= 4:
            max_temp = temps_raw[0]
            min_temp = min(temps_raw[1], temps_raw[2])
        elif len(temps_raw) == 3:
            max_temp = temps_raw[0]
            min_temp = temps_raw[1]
        elif len(temps_raw) >= 1:
            min_temp = min(temps_raw)
            max_temp = max(temps_raw)
            if wk_maxs:
                max_temp = max(max_temp, wk_maxs[0])
            if wk_mins:
                min_temp = min(min_temp, wk_mins[0])
        elif wk_maxs and wk_mins:
            max_temp = wk_maxs[0]
            min_temp = wk_mins[0]

        temp = temps_raw[0] if temps_raw else round((max_temp + min_temp) / 2)
        hourly, daily = _build_default_hourly_and_daily(temp, max_temp, min_temp, wmo_code, pop)

        # JMAの週間予報データがあれば反映
        wk_dates = (wk_ts[0].get("timeDefines") or []) if len(wk_ts) > 0 else []
        wk_codes = wk_area0.get("weatherCodes") or []
        wk_pops = wk_area0.get("pops") or []
        wk_mins_raw = wk_area1.get("tempsMin") or []
        wk_maxs_raw = wk_area1.get("tempsMax") or []
        if len(wk_dates) >= 5:
            parsed_daily: list[dict] = []
            for idx, d_str in enumerate(wk_dates[:7]):
                try:
                    dt = datetime.datetime.fromisoformat(d_str)
                    dow = DOW_JP[dt.weekday()]
                    d_code = _jma_code_to_wmo(wk_codes[idx] if idx < len(wk_codes) else jma_code)
                    d_pop_str = str(wk_pops[idx]).strip() if idx < len(wk_pops) else ""
                    d_pop = int(d_pop_str) if d_pop_str.isdigit() else pop
                    d_max_str = str(wk_maxs_raw[idx]).strip() if idx < len(wk_maxs_raw) else ""
                    d_min_str = str(wk_mins_raw[idx]).strip() if idx < len(wk_mins_raw) else ""
                    d_max = round(float(d_max_str)) if d_max_str else max_temp
                    d_min = round(float(d_min_str)) if d_min_str else min_temp
                    parsed_daily.append(
                        {
                            "date": f"{dt.month}/{dt.day}",
                            "dow": "今日" if idx == 0 else ("明日" if idx == 1 else dow),
                            "code": d_code,
                            "maxTemp": d_max,
                            "minTemp": d_min,
                            "pop": d_pop,
                        }
                    )
                except Exception:
                    continue
            if len(parsed_daily) >= 5:
                daily = parsed_daily

        return {
            "name": city["name"],
            "region": city["region"],
            "temp": temp,
            "code": wmo_code,
            "wind": 4,
            "maxTemp": max_temp,
            "minTemp": min_temp,
            "pop": pop,
            "hourly": hourly,
            "daily": daily,
        }
    except Exception:
        return None


DEFAULT_WEATHER_BY_NAME = {
    "札幌": {"name": "札幌", "region": "北海道", "temp": 7, "code": 3, "wind": 4, "maxTemp": 9, "minTemp": 2, "pop": 20},
    "仙台": {"name": "仙台", "region": "東北", "temp": 12, "code": 2, "wind": 5, "maxTemp": 14, "minTemp": 7, "pop": 20},
    "新潟": {"name": "新潟", "region": "北陸", "temp": 13, "code": 2, "wind": 6, "maxTemp": 15, "minTemp": 9, "pop": 30},
    "金沢": {"name": "金沢", "region": "北陸", "temp": 15, "code": 2, "wind": 4, "maxTemp": 17, "minTemp": 10, "pop": 30},
    "東京": {"name": "東京", "region": "関東", "temp": 15, "code": 1, "wind": 4, "maxTemp": 17, "minTemp": 10, "pop": 10},
    "名古屋": {"name": "名古屋", "region": "東海", "temp": 16, "code": 1, "wind": 3, "maxTemp": 18, "minTemp": 10, "pop": 10},
    "大阪": {"name": "大阪", "region": "近畿", "temp": 17, "code": 1, "wind": 3, "maxTemp": 19, "minTemp": 12, "pop": 10},
    "広島": {"name": "広島", "region": "中国", "temp": 18, "code": 1, "wind": 4, "maxTemp": 20, "minTemp": 12, "pop": 10},
    "高知": {"name": "高知", "region": "四国", "temp": 19, "code": 1, "wind": 4, "maxTemp": 21, "minTemp": 13, "pop": 10},
    "福岡": {"name": "福岡", "region": "九州", "temp": 18, "code": 2, "wind": 6, "maxTemp": 20, "minTemp": 13, "pop": 20},
    "那覇": {"name": "那覇", "region": "沖縄", "temp": 24, "code": 1, "wind": 10, "maxTemp": 26, "minTemp": 21, "pop": 10},
}


def _parse_open_meteo_entry(city: dict, data: dict) -> dict | None:
    cur = data.get("current") or {}
    if "temperature_2m" not in cur:
        return None
    daily_raw = data.get("daily") or {}
    hourly_raw = data.get("hourly") or {}
    temp = round(float(cur.get("temperature_2m", 0)))
    code = int(cur.get("weather_code", 0))
    max_temp = round(float((daily_raw.get("temperature_2m_max") or [temp])[0]))
    min_temp = round(float((daily_raw.get("temperature_2m_min") or [temp])[0]))
    pop = int((daily_raw.get("precipitation_probability_max") or [0])[0] or 0)

    fb_hourly, fb_daily = _build_default_hourly_and_daily(temp, max_temp, min_temp, code, pop)

    # 3時間ごとの予報（8枠）を抽出
    h_times = hourly_raw.get("time") or []
    h_temps = hourly_raw.get("temperature_2m") or []
    h_codes = hourly_raw.get("weather_code") or []
    h_pops = hourly_raw.get("precipitation_probability") or []
    now_str = datetime.datetime.now(JST).strftime("%Y-%m-%dT%H:00")
    start_idx = 0
    for idx, t_str in enumerate(h_times):
        if str(t_str) >= now_str:
            start_idx = idx
            break
    hourly_list: list[dict] = []
    for step in range(8):
        pos = start_idx + step * 3
        if pos >= len(h_times):
            break
        t_label = str(h_times[pos]).split("T")[-1][:5]
        hourly_list.append(
            {
                "time": t_label,
                "code": int(h_codes[pos] if pos < len(h_codes) and h_codes[pos] is not None else code),
                "temp": round(float(h_temps[pos] if pos < len(h_temps) and h_temps[pos] is not None else temp)),
                "pop": int(h_pops[pos] if pos < len(h_pops) and h_pops[pos] is not None else pop),
            }
        )

    # 7日間の週間予報を抽出
    d_times = daily_raw.get("time") or []
    d_codes = daily_raw.get("weather_code") or []
    d_maxs = daily_raw.get("temperature_2m_max") or []
    d_mins = daily_raw.get("temperature_2m_min") or []
    d_pops = daily_raw.get("precipitation_probability_max") or []
    daily_list: list[dict] = []
    for idx, d_str in enumerate(d_times[:7]):
        try:
            dt = datetime.date.fromisoformat(str(d_str))
            dow = DOW_JP[dt.weekday()]
            daily_list.append(
                {
                    "date": f"{dt.month}/{dt.day}",
                    "dow": "今日" if idx == 0 else ("明日" if idx == 1 else dow),
                    "code": int(d_codes[idx] if idx < len(d_codes) and d_codes[idx] is not None else code),
                    "maxTemp": round(float(d_maxs[idx] if idx < len(d_maxs) and d_maxs[idx] is not None else max_temp)),
                    "minTemp": round(float(d_mins[idx] if idx < len(d_mins) and d_mins[idx] is not None else min_temp)),
                    "pop": int(d_pops[idx] if idx < len(d_pops) and d_pops[idx] is not None else pop),
                }
            )
        except Exception:
            continue

    return {
        "name": city["name"],
        "region": city["region"],
        "temp": temp,
        "code": code,
        "wind": round(float(cur.get("wind_speed_10m", 0))),
        "maxTemp": max_temp,
        "minTemp": min_temp,
        "pop": pop,
        "hourly": hourly_list if len(hourly_list) >= 4 else fb_hourly,
        "daily": daily_list if len(daily_list) >= 5 else fb_daily,
    }


def fetch_all_cities_open_meteo_batch() -> dict[str, dict]:
    lats = ",".join(str(c["lat"]) for c in MAJOR_JP_CITIES)
    lons = ",".join(str(c["lon"]) for c in MAJOR_JP_CITIES)
    url = (
        f"https://api.open-meteo.com/v1/forecast?latitude={lats}&longitude={lons}"
        "&current=temperature_2m,weather_code,wind_speed_10m"
        "&hourly=temperature_2m,weather_code,precipitation_probability"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
        "&timezone=Asia%2FTokyo&forecast_days=7"
    )
    out: dict[str, dict] = {}
    try:
        raw = fetch_url_bytes(url, timeout=10)
        parsed = json.loads(raw.decode("utf-8"))
        entries = parsed if isinstance(parsed, list) else [parsed]
        for idx, city in enumerate(MAJOR_JP_CITIES):
            if idx < len(entries) and isinstance(entries[idx], dict):
                w = _parse_open_meteo_entry(city, entries[idx])
                if w:
                    out[city["name"]] = w
    except Exception:
        pass
    return out


def fetch_major_cities_weather(cached_weather: dict[str, dict]) -> list[dict]:
    fetched_by_name = fetch_all_cities_open_meteo_batch()
    missing_cities = [c for c in MAJOR_JP_CITIES if c["name"] not in fetched_by_name]

    if missing_cities:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            future_map = {pool.submit(fetch_city_weather_jma, c): c for c in missing_cities}
            for fut in concurrent.futures.as_completed(future_map):
                c = future_map[fut]
                res = fut.result()
                if res:
                    fetched_by_name[c["name"]] = res

    results: list[dict] = []
    for c in MAJOR_JP_CITIES:
        name = c["name"]
        item = (
            fetched_by_name.get(name)
            or cached_weather.get(name)
            or DEFAULT_WEATHER_BY_NAME.get(name)
        )
        if item:
            entry = dict(item)
            if not entry.get("hourly") or not entry.get("daily"):
                h, d = _build_default_hourly_and_daily(
                    int(entry.get("temp", 15)),
                    int(entry.get("maxTemp", 18)),
                    int(entry.get("minTemp", 10)),
                    int(entry.get("code", 1)),
                    int(entry.get("pop", 10)),
                )
                entry.setdefault("hourly", h)
                entry.setdefault("daily", d)
            results.append(entry)
    return results


def is_valid_ai_enriched(it: dict) -> bool:
    if not it.get("isAiEnriched"):
        return False
    summary = str(it.get("summary") or "").strip()
    if not summary or "に関する注目ニュースです" in summary:
        return False
    points = it.get("points") or []
    if not isinstance(points, list) or len(points) == 0:
        return False
    if any("「元記事を読む」から" in str(p) for p in points):
        return False
    return True


def apply_smart_fallback_enrichment(it: dict) -> None:
    """AI要約が未適用の記事に対しても、本文抜粋から具体的な要点3つを生成する"""
    if is_valid_ai_enriched(it):
        return
    cat_label = CATEGORY_LABELS.get(it.get("category", ""), "ニュース")
    title = str(it.get("title") or "").strip()
    summary = format_summary_text(str(it.get("summary") or ""), title)
    it["summary"] = summary
    src = str(it.get("source") or "ニュース配信").strip()
    pub = str(it.get("publishedAt") or "").strip()

    clauses = [
        c.strip(" 、。・…")
        for c in re.split(r"[。！？!?]|(?<=、)", summary)
        if len(c.strip(" 、。・…")) >= 10 and "に関する注目ニュースです" not in c
    ]
    points: list[str] = []
    for cl in clauses:
        pt = cl[:56] + ("…" if len(cl) > 56 else "")
        if pt not in points:
            points.append(pt)
        if len(points) >= 2:
            break
    if not points:
        points.append(f"トピック: {title[:48]}")
    points.append(f"分野・出典: {cat_label}（{src}{' / ' + pub if pub else ''}）")
    it["points"] = points[:3]
    if not it.get("impact") or "関心を集めている最新" in str(it.get("impact", "")) or "注目を集めている最新" in str(it.get("impact", "")):
        it["impact"] = f"「{title[:28]}」を巡る{cat_label}分野の注目動向として今後の展開が注目されます。"


def _dedupe_models(models: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in models:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _discover_gemini_text_models(api_key: str) -> list[str]:
    """利用可能なテキスト生成用Geminiモデル一覧をAPIから取得する"""
    url = "https://generativelanguage.googleapis.com/v1beta/models"
    req = urllib.request.Request(
        url,
        headers={"X-Goog-Api-Key": api_key},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models: list[str] = []
        excluded_tokens = (
            "tts",
            "image",
            "audio",
            "embedding",
            "vision",
            "live",
            "robotics",
            "computer-use",
            "aqa",
        )
        for m in data.get("models", []):
            name = str(m.get("name", ""))
            methods = m.get("supportedGenerationMethods") or []
            if name.startswith("models/") and "generateContent" in methods:
                short = name[len("models/") :]
                lower_short = short.lower()
                if lower_short.startswith("gemini") and not any(bad in lower_short for bad in excluded_tokens):
                    models.append(short)
        print(f"[INFO] Discovered Gemini text models: {models}", flush=True)
        return models
    except Exception as exc:
        print(f"[WARN] Failed to discover Gemini models: {exc}", flush=True)
        return []


def _extract_gemini_text(res_json: dict) -> str:
    """思考パート(thought=True)を除外してJSON応答テキストを抽出する"""
    candidates = res_json.get("candidates") or []
    if not candidates:
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    non_thought_texts = [
        str(p.get("text"))
        for p in parts
        if isinstance(p, dict) and not p.get("thought") and p.get("text")
    ]
    if non_thought_texts:
        return "\n".join(non_thought_texts)
    fallback_texts = [str(p.get("text")) for p in parts if isinstance(p, dict) and p.get("text")]
    return fallback_texts[-1] if fallback_texts else ""


def _parse_gemini_json_text(raw_text: str) -> dict | None:
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", cleaned)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    return None


def _build_gemini_payload(prompt: str, model_name: str, use_thinking_low: bool) -> bytes:
    gen_cfg: dict = {
        "responseMimeType": "application/json",
        "maxOutputTokens": 8192,
    }
    lower_name = model_name.lower()
    if use_thinking_low and any(tok in lower_name for tok in ("hydrogen", "gemini-4", "gemini-3.8", "gemini-3.6")):
        gen_cfg["thinkingConfig"] = {"thinkingLevel": "LOW"}
    return json.dumps(
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": gen_cfg,
        }
    ).encode("utf-8")


def _enrich_batch_with_gemini(
    batch_targets: list[tuple[int, dict]],
    api_key: str,
    model_candidates: list[str],
    disabled_models: set[str],
    disabled_lock: threading.Lock,
    include_keywords: bool = False,
    deadline_monotonic: float | None = None,
) -> tuple[int, list[str] | None, str]:
    prompt_articles = [
        {
            "index": i,
            "category": CATEGORY_LABELS.get(it["category"], "ニュース"),
            "title": it["title"],
            "source": it["source"],
            "snippet": it["summary"],
        }
        for i, it in batch_targets
    ]

    kw_instruction = (
        '  "keywords": ["注目キーワード1", "注目キーワード2", "注目キーワード3", "注目キーワード4", "注目キーワード5"],\n'
        if include_keywords
        else ""
    )
    prompt = (
        "あなたはニュースメディアの編集者です。以下の最新ニュースリストのすべての記事（全件漏れなく）について、"
        "ニュースサイトで読みやすい日本語の要約JSONを作成してください。\n\n"
        "出力は必ず以下のJSON形式のみ（マークダウン不要）で返してください:\n"
        "{\n"
        f"{kw_instruction}"
        '  "articles": [\n'
        "    {\n"
        '      "index": 0,\n'
        '      "title": "元の意味を保ちつつ読みやすく整えた見出し（38文字以内）",\n'
        '      "summary": "記事の概要を伝える完結したリード文（90文字前後）",\n'
        '      "points": ["具体的な要点1", "具体的な要点2", "具体的な要点3"],\n'
        '      "impact": "生活・仕事・市場への注目ポイント（70文字前後）",\n'
        '      "tags": ["タグ1", "タグ2", "タグ3"]\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        f"入力ニュース（全{len(prompt_articles)}件すべて出力すること）:\n"
        f"{json.dumps(prompt_articles, ensure_ascii=False)}"
    )

    parsed = None
    used_model = ""
    last_exc: Exception | None = None

    def _call_once(model_name: str, use_thinking_low: bool) -> dict | None:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        req = urllib.request.Request(
            url,
            data=_build_gemini_payload(prompt, model_name, use_thinking_low),
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": api_key,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=35) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
        text = _extract_gemini_text(res_json)
        return _parse_gemini_json_text(text)

    for model_name in model_candidates:
        if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
            break
        with disabled_lock:
            if model_name in disabled_models:
                continue

        lower_name = model_name.lower()
        has_thinking_cfg = any(tok in lower_name for tok in ("hydrogen", "gemini-4", "gemini-3.8", "gemini-3.6"))

        try:
            cand_parsed = _call_once(model_name, has_thinking_cfg)
            if cand_parsed and isinstance(cand_parsed.get("articles"), list) and len(cand_parsed["articles"]) > 0:
                parsed = cand_parsed
                used_model = model_name
                break
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read(200).decode("utf-8", errors="replace").replace("\n", " ").strip()
            except Exception:
                pass
            if exc.code == 400 and has_thinking_cfg:
                print(
                    f"[WARN] Gemini model {model_name} HTTP 400 with thinkingConfig ({err_body}); retrying without thinkingConfig",
                    flush=True,
                )
                try:
                    cand_parsed = _call_once(model_name, False)
                    if cand_parsed and isinstance(cand_parsed.get("articles"), list) and len(cand_parsed["articles"]) > 0:
                        parsed = cand_parsed
                        used_model = model_name
                        break
                except urllib.error.HTTPError as retry_exc:
                    last_exc = retry_exc
                    retry_body = ""
                    try:
                        retry_body = retry_exc.read(200).decode("utf-8", errors="replace").replace("\n", " ").strip()
                    except Exception:
                        pass
                    print(
                        f"[WARN] Gemini model {model_name} retry HTTP {retry_exc.code}: {retry_exc.reason} {retry_body}",
                        flush=True,
                    )
                    if retry_exc.code in (403, 404, 429):
                        with disabled_lock:
                            disabled_models.add(model_name)
                except Exception as retry_exc:
                    last_exc = retry_exc
                    print(f"[WARN] Gemini model {model_name} retry error: {retry_exc}", flush=True)
            else:
                last_exc = exc
                print(
                    f"[WARN] Gemini model {model_name} HTTP {exc.code}: {exc.reason} {err_body}",
                    flush=True,
                )
                if exc.code in (403, 404, 429):
                    with disabled_lock:
                        disabled_models.add(model_name)
        except Exception as exc:
            last_exc = exc
            print(f"[WARN] Gemini model {model_name} error: {exc}", flush=True)

    if not parsed:
        print(f"[WARN] Gemini batch enrichment failed ({len(batch_targets)} items): {last_exc}", flush=True)
        return 0, None, ""

    ai_map = {a.get("index"): a for a in parsed.get("articles", []) if isinstance(a, dict)}
    enriched_count = 0
    for i, item in batch_targets:
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
        enriched_count += 1

    keywords = None
    if include_keywords:
        kw_list = [str(k) for k in parsed.get("keywords", [])[:6] if str(k).strip()]
        keywords = kw_list or None

    return enriched_count, keywords, used_model


def enrich_with_gemini(items: list[dict], api_key: str) -> list[str] | None:
    targets = [(i, it) for i, it in enumerate(items) if not is_valid_ai_enriched(it)]
    if not targets:
        return None

    deadline = time.monotonic() + 130.0
    disabled_models: set[str] = set()
    disabled_lock = threading.Lock()

    discovered = _discover_gemini_text_models(api_key)

    hydrogen_detected = [m for m in discovered if "hydrogen" in m.lower()]
    if "gemini-4-hydrogen" in hydrogen_detected:
        hydrogen_detected = ["gemini-4-hydrogen"] + [m for m in hydrogen_detected if m != "gemini-4-hydrogen"]
    hydrogen_tier = _dedupe_models(hydrogen_detected + ["gemini-4-hydrogen"])

    flash38_detected = [m for m in discovered if "3.8-flash" in m.lower()]
    if "gemini-3.8-flash" in flash38_detected:
        flash38_detected = ["gemini-3.8-flash"] + [m for m in flash38_detected if m != "gemini-3.8-flash"]
    flash38_tier = _dedupe_models(flash38_detected + ["gemini-3.8-flash"])

    lite_base = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-2.5-flash-lite",
        "gemini-3.6-flash",
    ]
    other_flash = [m for m in discovered if "flash" in m.lower()]
    lite_tier = _dedupe_models(lite_base + other_flash)

    # 件数に応じてバッチ分割とモデル割り当てを決定
    if len(targets) > 30:
        batch_size = 15
        batches = [targets[i : i + batch_size] for i in range(0, len(targets), batch_size)]
        batch_model_lists = []
        for idx in range(len(batches)):
            if idx == 0:
                batch_model_lists.append(_dedupe_models(hydrogen_tier + flash38_tier + lite_tier))
            elif idx == 1:
                batch_model_lists.append(_dedupe_models(flash38_tier + hydrogen_tier + lite_tier))
            else:
                batch_model_lists.append(_dedupe_models(lite_tier + flash38_tier + hydrogen_tier))
    elif len(targets) >= 4:
        mid = (len(targets) + 1) // 2
        batches = [targets[:mid], targets[mid:]]
        batch_model_lists = [
            _dedupe_models(hydrogen_tier + flash38_tier + lite_tier),
            _dedupe_models(flash38_tier + hydrogen_tier + lite_tier),
        ]
    else:
        batches = [targets]
        if int(time.time() // 300) % 2 == 0:
            batch_model_lists = [_dedupe_models(hydrogen_tier + flash38_tier + lite_tier)]
        else:
            batch_model_lists = [_dedupe_models(flash38_tier + hydrogen_tier + lite_tier)]

    total_enriched = 0
    keywords: list[str] | None = None
    model_usage: dict[str, int] = {}

    # Batch 0 を実行して注目キーワードを確定
    first_cnt, first_kw, first_model = _enrich_batch_with_gemini(
        batches[0],
        api_key,
        batch_model_lists[0],
        disabled_models,
        disabled_lock,
        include_keywords=True,
        deadline_monotonic=deadline,
    )
    total_enriched += first_cnt
    if first_kw:
        keywords = first_kw
    if first_model:
        model_usage[first_model] = model_usage.get(first_model, 0) + first_cnt

    # 残りのバッチを2並列で実行（各バッチ固有の優先モデルリストを保持）
    if len(batches) > 1 and time.monotonic() < deadline:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(
                    _enrich_batch_with_gemini,
                    batches[idx],
                    api_key,
                    batch_model_lists[idx],
                    disabled_models,
                    disabled_lock,
                    False,
                    deadline,
                )
                for idx in range(1, len(batches))
            ]
            for fut in concurrent.futures.as_completed(futures):
                try:
                    cnt, _, used_m = fut.result()
                    total_enriched += cnt
                    if used_m:
                        model_usage[used_m] = model_usage.get(used_m, 0) + cnt
                except Exception:
                    pass

    print(
        f"[INFO] Gemini enrichment finished: "
        f"{total_enriched}/{len(targets)} target articles enriched (models: {model_usage})",
        flush=True,
    )
    return keywords


def interleave_top_items(*groups: list[dict]) -> list[dict]:
    ordered: list[dict] = []
    max_len = max((len(g) for g in groups), default=0)
    for i in range(max_len):
        for g in groups:
            if i < len(g):
                ordered.append(g[i])
    return ordered


def pick_unique_category_items(
    candidates: list[dict],
    seen: set[str],
    target_count: int = 30,
    now_ts: int | None = None,
) -> list[dict]:
    picked: list[dict] = []
    for it in candidates:
        ts = int(it.get("publishedTs") or 0)
        if not is_within_24h(ts, now_ts):
            continue
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
    now_ts = int(now.timestamp())

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        f_dom_y = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/topics/domestic.xml", "domestic", 25, now_ts)
        f_dom_t = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/topics/top-picks.xml", "domestic", 25, now_ts)
        f_dom_c = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/categories/domestic.xml", "domestic", 35, now_ts)
        f_dom_h = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/hotentry/social.rss", "domestic", 35, now_ts)
        f_dom_e = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/entrylist/social.rss", "domestic", 30, now_ts)

        f_tech_y = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/topics/it.xml", "tech", 25, now_ts)
        f_tech_c = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/categories/it.xml", "tech", 35, now_ts)
        f_tech_h = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/hotentry/it.rss", "tech", 35, now_ts)
        f_tech_e = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/entrylist/it.rss", "tech", 30, now_ts)
        f_tech_z = pool.submit(fetch_zenn_tech, 25, now_ts)

        f_biz_y = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/topics/business.xml", "business", 25, now_ts)
        f_biz_c = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/categories/business.xml", "business", 35, now_ts)
        f_biz_h = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/hotentry/economics.rss", "business", 35, now_ts)
        f_biz_e = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/entrylist/economics.rss", "business", 30, now_ts)

        f_ent_y = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/topics/entertainment.xml", "entertainment", 25, now_ts)
        f_ent_c = pool.submit(fetch_yahoo_topics, "https://news.yahoo.co.jp/rss/categories/entertainment.xml", "entertainment", 35, now_ts)
        f_ent_h = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/hotentry/entertainment.rss", "entertainment", 35, now_ts)
        f_ent_e = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/entrylist/entertainment.rss", "entertainment", 30, now_ts)
        f_ent_m = pool.submit(fetch_generic_feed, "https://natalie.mu/music/feed/news", "entertainment", "音楽ナタリー", 15, "音楽", now_ts)

        f_sub_auto = pool.submit(fetch_generic_feed, "https://automaton-media.com/feed/", "subculture", "AUTOMATON", 20, "ゲーム", now_ts)
        f_sub_comic = pool.submit(fetch_generic_feed, "https://natalie.mu/comic/feed/news", "subculture", "コミックナタリー", 20, "漫画・アニメ", now_ts)
        f_sub_vtuber = pool.submit(fetch_generic_feed, "https://panora.tokyo/feed/", "subculture", "PANORA", 15, "Vtuber", now_ts)
        f_sub_h = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/hotentry/game.rss", "subculture", 30, now_ts)
        f_sub_e = pool.submit(fetch_hatena_rss, "https://b.hatena.ne.jp/entrylist/game.rss", "subculture", 25, now_ts)

    domestic_candidates = (
        f_dom_y.result() + f_dom_t.result() + f_dom_c.result() + f_dom_h.result() + f_dom_e.result()
    )
    tech_candidates = (
        f_tech_y.result() + f_tech_c.result() + f_tech_h.result() + f_tech_z.result() + f_tech_e.result()
    )
    business_candidates = (
        f_biz_y.result() + f_biz_c.result() + f_biz_h.result() + f_biz_e.result()
    )
    entertainment_candidates = (
        f_ent_y.result() + f_ent_c.result() + f_ent_h.result() + f_ent_m.result() + f_ent_e.result()
    )
    subculture_candidates = interleave_top_items(
        f_sub_auto.result(), f_sub_comic.result(), f_sub_vtuber.result(), f_sub_h.result(), f_sub_e.result()
    )

    seen_global: set[str] = set()
    domestic = pick_unique_category_items(domestic_candidates, seen_global, target_count=30, now_ts=now_ts)
    tech = pick_unique_category_items(tech_candidates, seen_global, target_count=30, now_ts=now_ts)
    business = pick_unique_category_items(business_candidates, seen_global, target_count=30, now_ts=now_ts)
    entertainment = pick_unique_category_items(entertainment_candidates, seen_global, target_count=30, now_ts=now_ts)
    subculture = pick_unique_category_items(subculture_candidates, seen_global, target_count=30, now_ts=now_ts)

    items = interleave_top_items(domestic, tech, business, entertainment, subculture)
    if not items:
        raise RuntimeError("ニュースを1件も取得できませんでした。")

    # 既存キャッシュからAI要約・実画像・天気を引き継ぐ（24時間以内の記事のみ）
    cache, cached_keywords, cached_weather = load_cached_data(now_ts)
    for it in items:
        cached = cache.get(it.get("url", ""))
        if cached:
            if is_valid_ai_enriched(cached):
                it["title"] = cached.get("title", it["title"])
                it["summary"] = format_summary_text(cached.get("summary", it["summary"]), it["title"])
                it["points"] = cached.get("points", it["points"])
                it["impact"] = cached.get("impact", it["impact"])
                it["tags"] = cached.get("tags", it["tags"])
                it["isAiEnriched"] = True
            elif cached.get("summary") and "に関する注目ニュースです" not in cached.get("summary", ""):
                it["summary"] = format_summary_text(cached["summary"], it["title"])

            cached_img = cached.get("image", "")
            if (
                cached_img.startswith(("https://", "http://"))
                and not is_generic_logo_image(cached_img)
                and "tse2.mm.bing.net/th" not in cached_img
            ):
                it["image"] = cached_img
                it["hasRealImage"] = True

    # 全記事について引用元ページから記事内画像・OGPを並列取得（未取得時は関連Web画像へフォールバック）
    enrich_og_metadata_parallel(items)
    for it in items:
        img = (it.get("image") or "").strip()
        if not img.startswith(("https://", "http://")) or is_generic_logo_image(img):
            fb_img = (it.get("fallbackHatenaImg") or "").strip()
            if fb_img.startswith(("https://", "http://")) and not is_generic_logo_image(fb_img):
                it["image"] = fb_img
            else:
                it["image"] = build_related_web_image_url(it.get("title", ""), it.get("category", ""))

    weather_cities = fetch_major_cities_weather(cached_weather)

    keywords: list[str] = []
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        ai_keywords = enrich_with_gemini(items, api_key)
        if ai_keywords:
            keywords = ai_keywords
        elif cached_keywords:
            keywords = cached_keywords

    for it in items:
        apply_smart_fallback_enrichment(it)

    if not keywords:
        keywords = [
            (it["title"][:13] + "…") if len(it["title"]) > 13 else it["title"]
            for it in items[:6]
        ]

    clean_items = []
    for it in items:
        if not is_within_24h(int(it.get("publishedTs") or 0), now_ts):
            continue
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
        "weatherCities": weather_cities,
        "items": clean_items,
    }

    DATA_JS_PATH.parent.mkdir(parents=True, exist_ok=True)
    js_content = f"window.NEWS_DATA = {json.dumps(payload, ensure_ascii=False, indent=2)};\n"
    DATA_JS_PATH.write_text(js_content, encoding="utf-8")
    real_img_count = sum(
        1
        for it in clean_items
        if it["image"].startswith("https://") and "tse2.mm.bing.net/th" not in it["image"]
    )
    web_img_count = len(clean_items) - real_img_count
    print(
        f"Updated {len(clean_items)} news items ({real_img_count} article images, {web_img_count} related web images) -> {DATA_JS_PATH}"
    )


if __name__ == "__main__":
    main()

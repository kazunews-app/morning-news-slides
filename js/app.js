(() => {
  const CATEGORY_META = {
    domestic: { label: "国内・総合", icon: "🇯🇵", fallbackImg: "assets/images/news-1.jpg" },
    tech: { label: "テクノロジー・AI", icon: "🤖", fallbackImg: "assets/images/news-3.jpg" },
    business: { label: "ビジネス・経済", icon: "📈", fallbackImg: "assets/images/news-5.jpg" },
  };

  const state = {
    data: window.NEWS_DATA || { date: "--", updatedAt: "--", keywords: [], items: [] },
    category: "all",
    query: "",
    isReloading: false,
    lastDataSignature: "",
  };

  // DOM
  const elHeaderUpdated = document.getElementById("header-updated");
  const elSearchInput = document.getElementById("search-input");
  const elSearchClear = document.getElementById("search-clear");
  const elBtnRefresh = document.getElementById("btn-refresh");
  const elBtnTheme = document.getElementById("btn-theme");
  const elBrandReset = document.getElementById("brand-reset");
  const elTrendingTags = document.getElementById("trending-tags");
  const elFilterStatus = document.getElementById("filter-status");
  const elFilterStatusText = document.getElementById("filter-status-text");
  const elBtnClearFilter = document.getElementById("btn-clear-filter");
  const elHeroSection = document.getElementById("hero-section");
  const elHeroLead = document.getElementById("hero-lead");
  const elHeroSideList = document.getElementById("hero-side-list");
  const elFeedHeading = document.getElementById("feed-heading");
  const elFeedCount = document.getElementById("feed-count");
  const elNewsGrid = document.getElementById("news-grid");
  const elModal = document.getElementById("article-modal");
  const elModalDialog = elModal ? elModal.querySelector(".modal-dialog") : null;
  const elModalBackdrop = document.getElementById("modal-backdrop");
  const elModalClose = document.getElementById("modal-close");
  const elModalContent = document.getElementById("modal-content");
  const navTabs = document.querySelectorAll(".nav-tab");

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSafeHttpUrl(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    return trimmed.startsWith("https://") || trimmed.startsWith("http://");
  }

  function getCategoryMeta(cat) {
    return CATEGORY_META[cat] || { label: "ニュース", icon: "📰", fallbackImg: "assets/images/news-1.jpg" };
  }

  function getFallbackImage(item, index = 0) {
    if (item?.category === "domestic") {
      return index % 2 === 0 ? "assets/images/news-1.jpg" : "assets/images/news-2.jpg";
    }
    if (item?.category === "tech") {
      return index % 2 === 0 ? "assets/images/news-3.jpg" : "assets/images/news-4.jpg";
    }
    return index % 2 === 0 ? "assets/images/news-5.jpg" : "assets/images/news-6.jpg";
  }

  function getSafeImageUrl(item, index = 0) {
    const raw = typeof item?.image === "string" ? item.image.trim() : "";
    if (raw.startsWith("https://") || raw.startsWith("http://") || raw.startsWith("assets/")) {
      return raw;
    }
    return getFallbackImage(item, index);
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function formatRelativeTime(item) {
    if (Number.isFinite(item?.publishedTs) && item.publishedTs > 0) {
      const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - item.publishedTs);
      if (diffSec < 60) return "たった今";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
      return `${Math.floor(diffSec / 86400)}日前`;
    }
    return item?.publishedAt || "";
  }

  function normalizeKeywordQuery(kw) {
    return String(kw ?? "").replace(/[…\.]+$/g, "").trim();
  }

  function updateCounts() {
    const items = Array.isArray(state.data.items) ? state.data.items : [];
    const counts = { all: items.length, domestic: 0, tech: 0, business: 0 };
    items.forEach((it) => {
      if (it && counts[it.category] !== undefined) counts[it.category] += 1;
    });
    document.getElementById("count-all").textContent = counts.all;
    document.getElementById("count-domestic").textContent = counts.domestic;
    document.getElementById("count-tech").textContent = counts.tech;
    document.getElementById("count-business").textContent = counts.business;
  }

  function renderTrending() {
    const keywords = Array.isArray(state.data.keywords) ? state.data.keywords : [];
    const currentQ = state.query.trim().toLowerCase();
    elTrendingTags.innerHTML = keywords
      .map((kw) => {
        const searchVal = normalizeKeywordQuery(kw);
        const active = currentQ && currentQ === searchVal.toLowerCase() ? "active" : "";
        return `<button type="button" class="trending-chip ${active}" data-kw="${escapeHtml(searchVal)}"># ${escapeHtml(kw)}</button>`;
      })
      .join("");

    elTrendingTags.querySelectorAll(".trending-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kw = btn.getAttribute("data-kw") || "";
        if (state.query.trim().toLowerCase() === kw.toLowerCase()) {
          setQuery("");
        } else {
          setQuery(kw);
        }
      });
    });
  }

  function renderHero(items) {
    const lead = items[0];
    const sideItems = items.slice(1, 5);
    const leadMeta = getCategoryMeta(lead.category);
    const leadImg = getSafeImageUrl(lead, 0);
    const leadFallback = getFallbackImage(lead, 0);

    elHeroLead.innerHTML = `
      <article class="hero-card" data-article-idx="${lead._idx}">
        <div class="hero-image-wrap">
          <img src="${escapeHtml(leadImg)}" alt="${escapeHtml(lead.title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeHtml(leadFallback)}'" />
          <span class="hero-top-badge">TOP PICKUP</span>
        </div>
        <div class="hero-body">
          <div class="meta-row">
            <span class="cat-pill ${escapeHtml(lead.category)}">${leadMeta.icon} ${escapeHtml(leadMeta.label)}</span>
            <span>${escapeHtml(lead.source || "")}</span>
            <span>•</span>
            <span>${escapeHtml(formatRelativeTime(lead))}</span>
          </div>
          <h1 class="hero-title">${escapeHtml(lead.title)}</h1>
          <p class="hero-summary">${escapeHtml(lead.summary)}</p>
        </div>
      </article>
    `;

    elHeroSideList.innerHTML = sideItems
      .map((item, i) => {
        const meta = getCategoryMeta(item.category);
        const img = getSafeImageUrl(item, i + 1);
        const fb = getFallbackImage(item, i + 1);
        return `
          <button type="button" class="side-item" data-article-idx="${item._idx}">
            <img class="side-thumb" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeHtml(fb)}'" />
            <div class="side-item-body">
              <div class="meta-row">
                <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
                <span>${escapeHtml(formatRelativeTime(item))}</span>
              </div>
              <div class="side-item-title">${escapeHtml(item.title)}</div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  function renderFeed() {
    const rawItems = Array.isArray(state.data.items) ? state.data.items : [];
    const allWithIdx = rawItems.map((item, idx) => ({ ...item, _idx: idx }));
    const q = state.query.trim();

    if (q) {
      elFilterStatus.hidden = false;
      elFilterStatusText.textContent = `「${q}」の検索結果`;
    } else {
      elFilterStatus.hidden = true;
    }

    const filtered = allWithIdx.filter((item) => {
      if (state.category !== "all" && item.category !== state.category) return false;
      if (!q) return true;
      const qLower = q.toLowerCase();
      const haystack = [
        item.title,
        item.summary,
        item.source,
        item.impact,
        ...(Array.isArray(item.tags) ? item.tags : []),
        ...(Array.isArray(item.points) ? item.points : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(qLower);
    });

    const isTopOverview = state.category === "all" && !q && filtered.length >= 5;
    let gridItems = filtered;

    if (isTopOverview) {
      elHeroSection.hidden = false;
      renderHero(filtered);
      gridItems = filtered.slice(5);
      elFeedHeading.textContent = "最新ニュース一覧";
    } else {
      elHeroSection.hidden = true;
      const meta = getCategoryMeta(state.category);
      elFeedHeading.textContent =
        state.category === "all" ? "検索結果" : `${meta.icon} ${meta.label}のニュース`;
    }

    elFeedCount.textContent = `${filtered.length}件の記事`;

    if (gridItems.length === 0 && !isTopOverview) {
      elNewsGrid.innerHTML = `
        <div class="empty-state">
          <p>条件に一致するニュースが見つかりませんでした。</p>
        </div>
      `;
    } else {
      elNewsGrid.innerHTML = gridItems
        .map((item, i) => {
          const meta = getCategoryMeta(item.category);
          const img = getSafeImageUrl(item, i);
          const fb = getFallbackImage(item, i);
          const tagsHtml = (Array.isArray(item.tags) ? item.tags : [])
            .slice(0, 3)
            .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
            .join("");

          return `
            <article class="news-card" data-article-idx="${item._idx}">
              <div class="card-thumb-wrap">
                <img src="${escapeHtml(img)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeHtml(fb)}'" />
              </div>
              <div class="card-body">
                <div class="meta-row">
                  <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
                  <span>${escapeHtml(item.source || "")}</span>
                  <span>•</span>
                  <span>${escapeHtml(formatRelativeTime(item))}</span>
                </div>
                <h3 class="card-title">${escapeHtml(item.title)}</h3>
                <p class="card-summary">${escapeHtml(item.summary)}</p>
                <div class="card-tags">${tagsHtml}</div>
              </div>
            </article>
          `;
        })
        .join("");
    }

    document.querySelectorAll("[data-article-idx]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-article-idx"));
        openArticleModal(idx);
      });
    });
  }

  function openArticleModal(idx) {
    const items = Array.isArray(state.data.items) ? state.data.items : [];
    const item = items[idx];
    if (!item) return;

    const meta = getCategoryMeta(item.category);
    const img = getSafeImageUrl(item, idx);
    const fb = getFallbackImage(item, idx);
    const pointsHtml = (Array.isArray(item.points) ? item.points : [])
      .map((pt) => `<li>${escapeHtml(pt)}</li>`)
      .join("");
    const tagsHtml = (Array.isArray(item.tags) ? item.tags : [])
      .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
      .join("");
    const safeUrl = isSafeHttpUrl(item.url) ? item.url.trim() : "";

    elModalContent.innerHTML = `
      <img class="modal-hero-img" src="${escapeHtml(img)}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeHtml(fb)}'" />
      <div class="modal-body">
        <div class="meta-row">
          <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
          <span>${escapeHtml(item.source || "")}</span>
          <span>•</span>
          <span>${escapeHtml(item.publishedAt || formatRelativeTime(item))}</span>
        </div>
        <h2 class="modal-title" id="modal-title">${escapeHtml(item.title)}</h2>
        <p class="modal-lead">${escapeHtml(item.summary)}</p>

        ${
          pointsHtml
            ? `<div class="modal-box">
                <h3>📌 3つの要点</h3>
                <ul class="modal-points">${pointsHtml}</ul>
              </div>`
            : ""
        }

        ${
          item.impact
            ? `<div class="modal-box">
                <h3>💡 注目ポイント・影響</h3>
                <p class="modal-impact">${escapeHtml(item.impact)}</p>
              </div>`
            : ""
        }

        <div class="modal-actions">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>
          ${
            safeUrl
              ? `<a class="read-original-btn" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">元記事を読む ↗</a>`
              : ""
          }
        </div>
      </div>
    `;

    elModal.hidden = false;
    if (elModalDialog) elModalDialog.scrollTop = 0;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    elModal.hidden = true;
    document.body.style.overflow = "";
  }

  function setQuery(q) {
    state.query = q;
    elSearchInput.value = q;
    elSearchClear.hidden = !q;
    renderTrending();
    renderFeed();
  }

  function setCategory(cat) {
    state.category = cat;
    navTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.getAttribute("data-category") === cat);
    });
    renderFeed();
  }

  function parseNewsJsText(text) {
    const prefix = "window.NEWS_DATA =";
    const idx = text.indexOf(prefix);
    if (idx === -1) return null;
    const jsonPart = text.slice(idx + prefix.length).trim().replace(/;\s*$/, "");
    return JSON.parse(jsonPart);
  }

  function parseUpdatedAtMs(updatedAtStr) {
    if (!updatedAtStr || typeof updatedAtStr !== "string") return 0;
    const normalized = updatedAtStr.trim().replace(/\//g, "-").replace(" ", "T");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return 0;
    const iso = normalized.length === 16 ? `${normalized}:00+09:00` : `${normalized}+09:00`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
  }

  function formatNowJst() {
    const now = new Date();
    const jstMs = now.getTime() + (now.getTimezoneOffset() + 540) * 60000;
    const jst = new Date(jstMs);
    const y = jst.getFullYear();
    const m = jst.getMonth() + 1;
    const d = jst.getDate();
    const hh = String(jst.getHours()).padStart(2, "0");
    const mm = String(jst.getMinutes()).padStart(2, "0");
    const dow = ["日", "月", "火", "水", "木", "金", "土"][jst.getDay()];
    return {
      date: `${y}年${m}月${d}日 (${dow})`,
      updatedAt: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${hh}:${mm}`,
    };
  }

  function computeDataSignature(data) {
    if (!data || !Array.isArray(data.items)) return "";
    const firstTitle = data.items[0]?.title || "";
    const firstImg = data.items[0]?.image || "";
    return `${data.updatedAt || ""}|${data.items.length}|${firstTitle}|${firstImg}`;
  }

  function applyNewsDataIfNewer(candidate, forceApply = false) {
    if (!candidate || !Array.isArray(candidate.items) || candidate.items.length === 0) return false;
    const currentMs = parseUpdatedAtMs(state.data?.updatedAt);
    const candidateMs = parseUpdatedAtMs(candidate.updatedAt);
    if (!forceApply && currentMs > 0 && candidateMs > 0 && candidateMs < currentMs) {
      return false;
    }
    const sig = computeDataSignature(candidate);
    if (forceApply || sig !== state.lastDataSignature) {
      window.NEWS_DATA = candidate;
      state.data = candidate;
      state.lastDataSignature = sig;
      try {
        localStorage.setItem("trend-news-live-cache", JSON.stringify(candidate));
      } catch (_e) {}
      renderAll();
      return true;
    }
    return false;
  }

  function restoreCachedNewsOnStartup() {
    try {
      const raw = localStorage.getItem("trend-news-live-cache");
      if (!raw) return;
      const cached = JSON.parse(raw);
      applyNewsDataIfNewer(cached, false);
    } catch (_e) {}
  }

  async function fetchGithubNewsData() {
    const ts = Date.now();
    // 1. GitHub Contents API (Fastly CDNの5分キャッシュを回避して最新コミットを即時取得)
    try {
      const apiUrl = `https://api.github.com/repos/sjhkazu1011-ctrl/morning-news-slides/contents/data/news.js?ref=main&_=${ts}`;
      const res = await fetchWithTimeout(apiUrl, { cache: "no-store" }, 7000);
      if (res.ok) {
        const meta = await res.json();
        if (meta && typeof meta.content === "string") {
          const binStr = atob(meta.content.replace(/\s/g, ""));
          const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
          const text = new TextDecoder("utf-8").decode(bytes);
          const parsed = parseNewsJsText(text);
          if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
            return parsed;
          }
        }
      }
    } catch (_e) {}

    // 2. Fallback: raw.githubusercontent.com & local data/news.js
    const fallbackUrls = [
      `https://raw.githubusercontent.com/sjhkazu1011-ctrl/morning-news-slides/main/data/news.js?t=${ts}`,
      `data/news.js?t=${ts}`,
    ];
    for (const url of fallbackUrls) {
      try {
        const res = await fetchWithTimeout(url, { cache: "no-store" }, 7000);
        if (!res.ok) continue;
        const text = await res.text();
        const parsed = parseNewsJsText(text);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          return parsed;
        }
      } catch (_e) {}
    }
    return null;
  }

  async function fetchRssItemsViaProxy(rssUrl, category, sourceFallback, limit) {
    const ts = Date.now();
    // Try rss2json first, then allorigins XML
    try {
      const r2jUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&_=${ts}`;
      const res = await fetchWithTimeout(r2jUrl, { cache: "no-store" }, 6500);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.items) && data.items.length > 0) {
          return data.items.slice(0, limit).map((it, idx) => {
            const title = (it.title || "").trim();
            const link = (it.link || "").trim();
            const pubMs = it.pubDate ? Date.parse(it.pubDate.replace(" ", "T") + "Z") : Date.now();
            const publishedTs = Number.isFinite(pubMs) ? Math.floor(pubMs / 1000) : Math.floor(Date.now() / 1000);
            const thumb = it.thumbnail || it.enclosure?.link || it.enclosure?.thumbnail || "";
            return {
              category,
              title,
              url: link,
              source: sourceFallback,
              publishedTs,
              publishedAt: it.pubDate ? it.pubDate.slice(0, 16) : formatNowJst().updatedAt,
              rawThumb: thumb.startsWith("https://") ? thumb : "",
              rawDesc: it.description || "",
              idx,
            };
          });
        }
      }
    } catch (_e) {}

    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}&_=${ts}`;
      const res = await fetchWithTimeout(proxyUrl, { cache: "no-store" }, 7000);
      if (res.ok) {
        const xmlText = await res.text();
        const doc = new DOMParser().parseFromString(xmlText, "text/xml");
        const nodes = Array.from(doc.querySelectorAll("item")).slice(0, limit);
        return nodes.map((node, idx) => {
          const title = (node.querySelector("title")?.textContent || "").trim();
          const link = (node.querySelector("link")?.textContent || "").trim();
          const pubRaw =
            node.querySelector("pubDate")?.textContent ||
            node.getElementsByTagName("dc:date")?.[0]?.textContent ||
            "";
          const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
          const publishedTs = Number.isFinite(pubMs) ? Math.floor(pubMs / 1000) : Math.floor(Date.now() / 1000);
          const hatenaImg = node.getElementsByTagName("hatena:imageurl")?.[0]?.textContent || "";
          const desc = node.querySelector("description")?.textContent || "";
          return {
            category,
            title,
            url: link,
            source: sourceFallback,
            publishedTs,
            publishedAt: formatNowJst().updatedAt,
            rawThumb: hatenaImg.startsWith("https://") ? hatenaImg : "",
            rawDesc: desc,
            idx,
          };
        });
      }
    } catch (_e) {}
    return [];
  }

  async function fetchLiveOgForUrl(url) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const res = await fetchWithTimeout(proxyUrl, {}, 5000);
      if (!res.ok) return {};
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const ogImg =
        doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
        doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ||
        "";
      const ogDesc =
        doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
        doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
        "";
      return {
        image: ogImg.startsWith("https://") && !ogImg.includes("ogp_default") ? ogImg : "",
        summary: ogDesc ? ogDesc.trim() : "",
      };
    } catch (_e) {
      return {};
    }
  }

  async function fetchLiveBrowserNews(baseData) {
    const existingByUrl = new Map();
    const existingByTitle = new Map();
    (baseData?.items || []).forEach((it) => {
      if (it?.url) existingByUrl.set(it.url, it);
      if (it?.title) existingByTitle.set(it.title, it);
    });

    const [domYahoo, domHatena, techYahoo, techHatena, bizYahoo, bizHatena] = await Promise.all([
      fetchRssItemsViaProxy("https://news.yahoo.co.jp/rss/topics/domestic.xml", "domestic", "Yahoo!ニュース", 7),
      fetchRssItemsViaProxy("https://b.hatena.ne.jp/hotentry/social.rss", "domestic", "はてなブックマーク", 6),
      fetchRssItemsViaProxy("https://news.yahoo.co.jp/rss/topics/it.xml", "tech", "Yahoo!ニュース", 7),
      fetchRssItemsViaProxy("https://b.hatena.ne.jp/hotentry/it.rss", "tech", "はてなブックマーク", 6),
      fetchRssItemsViaProxy("https://news.yahoo.co.jp/rss/topics/business.xml", "business", "Yahoo!ニュース", 7),
      fetchRssItemsViaProxy("https://b.hatena.ne.jp/hotentry/economics.rss", "business", "はてなブックマーク", 6),
    ]);

    const totalFetched =
      domYahoo.length + domHatena.length + techYahoo.length + techHatena.length + bizYahoo.length + bizHatena.length;
    if (totalFetched === 0) return null;

    const seen = new Set();
    async function buildCategoryList(rawCandidates, existingCatItems, catKey) {
      const catMeta = getCategoryMeta(catKey);
      const list = [];
      for (const raw of rawCandidates) {
        if (!raw.title || !raw.url) continue;
        if (seen.has(raw.url) || seen.has(raw.title)) continue;
        seen.add(raw.url);
        seen.add(raw.title);

        const cached = existingByUrl.get(raw.url) || existingByTitle.get(raw.title);
        if (cached) {
          list.push({ ...cached, category: catKey });
        } else {
          let img = raw.rawThumb || getFallbackImage({ category: catKey }, list.length);
          let summary = raw.rawDesc
            ? raw.rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            : `「${raw.title}」に関する注目ニュースです。詳細は元記事から確認できます。`;
          if (summary.length > 150) summary = summary.slice(0, 149) + "…";

          if (!raw.rawThumb && raw.url.includes("news.yahoo.co.jp")) {
            const og = await fetchLiveOgForUrl(raw.url);
            if (og.image) img = og.image;
            if (og.summary && og.summary.length >= 20) {
              summary = og.summary.endsWith("。") ? og.summary : og.summary + "…";
            }
          }

          list.push({
            category: catKey,
            title: raw.title,
            source: raw.source,
            publishedAt: raw.publishedAt,
            publishedTs: raw.publishedTs,
            image: img,
            summary,
            points: [
              `カテゴリ: ${catMeta.label}の最新トピック`,
              `配信: ${raw.source}（${raw.publishedAt}）`,
              "「元記事を読む」から詳細を確認できます",
            ],
            impact: `${catMeta.label}分野で関心を集めている最新ニュースです。`,
            tags: [catMeta.label, raw.source],
            url: raw.url,
            isAiEnriched: false,
          });
        }
        if (list.length >= 10) break;
      }

      // 10件に満たない場合は既存キャッシュ記事で補完
      for (const oldIt of existingCatItems) {
        if (list.length >= 10) break;
        if (!seen.has(oldIt.url) && !seen.has(oldIt.title)) {
          seen.add(oldIt.url);
          seen.add(oldIt.title);
          list.push(oldIt);
        }
      }
      return list;
    }

    const oldDom = (baseData?.items || []).filter((i) => i.category === "domestic");
    const oldTech = (baseData?.items || []).filter((i) => i.category === "tech");
    const oldBiz = (baseData?.items || []).filter((i) => i.category === "business");

    const [domList, techList, bizList] = await Promise.all([
      buildCategoryList([...domYahoo, ...domHatena], oldDom, "domestic"),
      buildCategoryList([...techYahoo, ...techHatena], oldTech, "tech"),
      buildCategoryList([...bizYahoo, ...bizHatena], oldBiz, "business"),
    ]);

    const interleaved = [];
    const buckets = [domList, techList, bizList];
    while (buckets.some((b) => b.length > 0)) {
      for (const b of buckets) {
        if (b.length > 0) interleaved.push(b.shift());
      }
    }

    if (interleaved.length === 0) return null;

    const nowJst = formatNowJst();
    const keywords = interleaved.slice(0, 6).map((it) =>
      it.title.length > 13 ? it.title.slice(0, 13) + "…" : it.title
    );

    return {
      date: nowJst.date,
      updatedAt: nowJst.updatedAt,
      title: "TREND NEWS",
      keywords,
      items: interleaved,
    };
  }

  async function reloadNewsData(isManual = false) {
    if (state.isReloading) return;
    state.isReloading = true;
    elBtnRefresh.classList.add("spinning");

    try {
      // Step 1: GitHub APIから最新コミットの data/news.js をキャッシュなしで取得
      const ghData = await fetchGithubNewsData();
      if (ghData) {
        applyNewsDataIfNewer(ghData, isManual);
      }

      // Step 2: GitHub Actionsの定期実行が5分以上遅延している場合、または手動更新ボタン押下時は
      // ブラウザから直接Yahoo!ニュース/はてなRSSを取得してリアルタイム更新する
      const ageMs = Date.now() - parseUpdatedAtMs(state.data?.updatedAt);
      if (isManual || ageMs >= 5 * 60 * 1000) {
        const liveData = await fetchLiveBrowserNews(state.data);
        if (liveData) {
          applyNewsDataIfNewer(liveData, true);
        } else if (isManual) {
          // 通信制限等で外部RSSプロキシが応答しない場合でも現在時刻で再描画
          const nowJst = formatNowJst();
          state.data.updatedAt = nowJst.updatedAt;
          renderAll();
        }
      }
    } finally {
      elBtnRefresh.classList.remove("spinning");
      state.isReloading = false;
    }
  }

  // Weather (Geolocation + Open-Meteo + Reverse Geocoding)
  const elWeatherWidget = document.getElementById("weather-widget");
  const elWeatherIcon = document.getElementById("weather-icon");
  const elWeatherLoc = document.getElementById("weather-loc");
  const elWeatherTemp = document.getElementById("weather-temp");
  const elWeatherSub = document.getElementById("weather-sub");

  function getWeatherMeta(code) {
    if (code === 0) return { icon: "☀️", label: "快晴" };
    if (code === 1 || code === 2) return { icon: "🌤️", label: "晴れ" };
    if (code === 3) return { icon: "☁️", label: "くもり" };
    if (code === 45 || code === 48) return { icon: "🌫️", label: "霧" };
    if (code >= 51 && code <= 67) return { icon: "🌧️", label: "雨" };
    if (code >= 71 && code <= 77) return { icon: "❄️", label: "雪" };
    if (code >= 80 && code <= 82) return { icon: "🌦️", label: "にわか雨" };
    if (code >= 85 && code <= 86) return { icon: "🌨️", label: "吹雪" };
    if (code >= 95) return { icon: "⛈️", label: "雷雨" };
    return { icon: "⛅", label: "天気" };
  }

  async function resolveLocationName(lat, lon) {
    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`;
      const res = await fetchWithTimeout(url, {}, 6000);
      if (!res.ok) return "現在地";
      const data = await res.json();
      const city = data.city || data.locality || data.principalSubdivision || "現在地";
      return city.replace(/^(東京都|大阪府|京都府|北海道)/, "$1 ");
    } catch (_e) {
      return "現在地";
    }
  }

  async function fetchAndRenderWeather(lat, lon, locName) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=1`;
      const res = await fetchWithTimeout(url, {}, 8000);
      if (!res.ok) throw new Error("Weather fetch failed");
      const data = await res.json();

      const currentTemp = Math.round(data.current?.temperature_2m ?? 0);
      const code = data.current?.weather_code ?? 0;
      const meta = getWeatherMeta(code);

      const maxTemp = Math.round(data.daily?.temperature_2m_max?.[0] ?? currentTemp);
      const minTemp = Math.round(data.daily?.temperature_2m_min?.[0] ?? currentTemp);
      const pop = data.daily?.precipitation_probability_max?.[0] ?? 0;

      elWeatherIcon.textContent = meta.icon;
      elWeatherLoc.textContent = `📍 ${locName}`;
      elWeatherTemp.textContent = `${currentTemp}°C`;
      elWeatherSub.textContent = `${meta.label} H:${maxTemp}° L:${minTemp}° ☔${pop}%`;
    } catch (_err) {
      elWeatherSub.textContent = "天気を取得できませんでした";
    }
  }

  async function searchCityCoords(cityName) {
    const q = cityName.trim();
    if (!q) return null;
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ja&format=json`;
      const res = await fetchWithTimeout(url, {}, 6000);
      if (!res.ok) return null;
      const data = await res.json();
      const first = data.results?.[0];
      if (!first) return null;
      return {
        lat: Number(first.latitude.toFixed(4)),
        lon: Number(first.longitude.toFixed(4)),
        locName: first.name || q,
      };
    } catch (_e) {
      return null;
    }
  }

  async function promptManualCity() {
    const input = window.prompt(
      "iPhoneの位置情報サービスがオフか拒否されています。\n天気を表示したい市区町村名（例: 横浜市、大阪市、札幌市、新宿区）を入力してください:",
      ""
    );
    if (!input) return;
    elWeatherSub.textContent = "地域を検索中...";
    const found = await searchCityCoords(input);
    if (found) {
      localStorage.setItem("trend-news-geo", JSON.stringify(found));
      await fetchAndRenderWeather(found.lat, found.lon, found.locName);
    } else {
      elWeatherSub.textContent = "地域が見つかりませんでした(タップで再試行)";
    }
  }

  function requestGeolocationWeather(isUserTap = false) {
    if (!navigator.geolocation) {
      if (isUserTap) promptManualCity();
      return;
    }
    if (isUserTap) {
      elWeatherLoc.textContent = "📍 測位中...";
      elWeatherSub.textContent = "現在地を取得しています...";
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const locName = await resolveLocationName(lat, lon);
        localStorage.setItem("trend-news-geo", JSON.stringify({ lat, lon, locName }));
        await fetchAndRenderWeather(lat, lon, locName);
      },
      async (_err) => {
        if (isUserTap) {
          await promptManualCity();
        } else {
          await fetchAndRenderWeather(35.6812, 139.7671, "東京(タップで現在地へ)");
        }
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  }

  function refreshSavedWeather() {
    try {
      const saved = JSON.parse(localStorage.getItem("trend-news-geo") || "null");
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
        fetchAndRenderWeather(saved.lat, saved.lon, saved.locName || "現在地");
        return true;
      }
    } catch (_e) {}
    return false;
  }

  function initWeather() {
    if (elWeatherWidget) {
      elWeatherWidget.addEventListener("click", () => requestGeolocationWeather(true));
    }
    if (refreshSavedWeather()) {
      return;
    }
    fetchAndRenderWeather(35.6812, 139.7671, "東京(タップで現在地へ)");
    requestGeolocationWeather(false);
  }

  // Theme
  function initTheme() {
    const saved = localStorage.getItem("trend-news-theme") || localStorage.getItem("morning-news-theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("trend-news-theme", next);
  }

  function renderAll() {
    elHeaderUpdated.textContent = `更新: ${state.data.updatedAt || state.data.date || "--"}`;
    updateCounts();
    renderTrending();
    renderFeed();
  }

  // Events
  navTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setCategory(tab.getAttribute("data-category"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  elSearchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    elSearchClear.hidden = !state.query;
    renderTrending();
    renderFeed();
  });

  elSearchClear.addEventListener("click", () => setQuery(""));
  elBtnClearFilter.addEventListener("click", () => {
    setCategory("all");
    setQuery("");
  });
  elBrandReset.addEventListener("click", (e) => {
    e.preventDefault();
    setCategory("all");
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  elBtnRefresh.addEventListener("click", () => reloadNewsData(true));
  elBtnTheme.addEventListener("click", toggleTheme);
  elModalClose.addEventListener("click", closeModal);
  elModalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !elModal.hidden) closeModal();
  });

  // Init
  initTheme();
  initWeather();
  state.lastDataSignature = computeDataSignature(state.data);
  restoreCachedNewsOnStartup();
  renderAll();
  reloadNewsData(false);
  setInterval(() => reloadNewsData(false), 5 * 60 * 1000);
  setInterval(refreshSavedWeather, 30 * 60 * 1000);
})();

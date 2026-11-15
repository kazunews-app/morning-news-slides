(() => {
  const CATEGORY_META = {
    domestic: { label: "国内・総合", icon: "🇯🇵", fallbackImg: "assets/images/news-1.jpg" },
    tech: { label: "テクノロジー・AI", icon: "🤖", fallbackImg: "assets/images/news-3.jpg" },
    business: { label: "ビジネス・経済", icon: "📈", fallbackImg: "assets/images/news-5.jpg" },
    entertainment: { label: "芸能・エンタメ", icon: "🎬", fallbackImg: "assets/images/news-2.jpg" },
    subculture: { label: "サブカルチャー", icon: "🎮", fallbackImg: "assets/images/news-4.jpg" },
    weather: { label: "天気", icon: "☀️", fallbackImg: "assets/images/news-1.jpg" },
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
  const elTrendingBar = document.getElementById("trending-bar");
  const elTrendingTags = document.getElementById("trending-tags");
  const elFilterStatus = document.getElementById("filter-status");
  const elFilterStatusText = document.getElementById("filter-status-text");
  const elBtnClearFilter = document.getElementById("btn-clear-filter");
  const elHeroSection = document.getElementById("hero-section");
  const elHeroLead = document.getElementById("hero-lead");
  const elHeroSideList = document.getElementById("hero-side-list");
  const elFeedSection = document.getElementById("feed-section");
  const elFeedHeading = document.getElementById("feed-heading");
  const elFeedCount = document.getElementById("feed-count");
  const elNewsGrid = document.getElementById("news-grid");
  const elTextFeedWrap = document.getElementById("text-feed-wrap");
  const elTextFeedCount = document.getElementById("text-feed-count");
  const elNewsTextList = document.getElementById("news-text-list");
  const elWeatherSection = document.getElementById("weather-section");
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
    if (item?.category === "entertainment") {
      return index % 2 === 0 ? "assets/images/news-2.jpg" : "assets/images/news-6.jpg";
    }
    if (item?.category === "subculture") {
      return index % 2 === 0 ? "assets/images/news-4.jpg" : "assets/images/news-3.jpg";
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
    const counts = { all: items.length, domestic: 0, tech: 0, business: 0, entertainment: 0, subculture: 0 };
    items.forEach((it) => {
      if (it && counts[it.category] !== undefined) counts[it.category] += 1;
    });
    document.getElementById("count-all").textContent = counts.all;
    document.getElementById("count-domestic").textContent = counts.domestic;
    document.getElementById("count-tech").textContent = counts.tech;
    document.getElementById("count-business").textContent = counts.business;
    const elEnt = document.getElementById("count-entertainment");
    if (elEnt) elEnt.textContent = counts.entertainment;
    const elSub = document.getElementById("count-subculture");
    if (elSub) elSub.textContent = counts.subculture;
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
    const q = state.query.trim();
    if (state.category === "weather" && !q) {
      if (elTrendingBar) elTrendingBar.hidden = true;
      elFilterStatus.hidden = true;
      elHeroSection.hidden = true;
      if (elFeedSection) elFeedSection.hidden = true;
      if (elWeatherSection) elWeatherSection.hidden = false;
      ensureWeatherLoadedAndRender();
      return;
    }

    if (elTrendingBar) elTrendingBar.hidden = false;
    if (elFeedSection) elFeedSection.hidden = false;
    if (elWeatherSection) elWeatherSection.hidden = true;

    const rawItems = Array.isArray(state.data.items) ? state.data.items : [];
    const allWithIdx = rawItems.map((item, idx) => ({ ...item, _idx: idx }));

    if (q) {
      elFilterStatus.hidden = false;
      elFilterStatusText.textContent = `「${q}」の検索結果`;
    } else {
      elFilterStatus.hidden = true;
    }

    const filtered = allWithIdx.filter((item) => {
      if (state.category !== "all" && state.category !== "weather" && item.category !== state.category) {
        return false;
      }
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
    const visualItems = filtered.slice(0, 10);
    const textItems = filtered.slice(10);
    let gridItems = visualItems;

    if (isTopOverview) {
      elHeroSection.hidden = false;
      renderHero(visualItems);
      gridItems = visualItems.slice(5);
      elFeedHeading.textContent = "注目のトレンド記事（TOP 10）";
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

    if (elTextFeedWrap && elNewsTextList) {
      if (textItems.length > 0) {
        elTextFeedWrap.hidden = false;
        if (elTextFeedCount) elTextFeedCount.textContent = `${textItems.length}件`;
        elNewsTextList.innerHTML = textItems
          .map((item, idx) => {
            const meta = getCategoryMeta(item.category);
            const rank = idx + 11;
            return `
              <article class="text-news-item" data-article-idx="${item._idx}">
                <span class="text-news-rank">${rank}</span>
                <div class="text-news-body">
                  <div class="meta-row">
                    <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
                    <span>${escapeHtml(item.source || "")}</span>
                    <span>•</span>
                    <span>${escapeHtml(formatRelativeTime(item))}</span>
                  </div>
                  <h3 class="text-news-title">${escapeHtml(item.title)}</h3>
                  <p class="text-news-summary">${escapeHtml(item.summary)}</p>
                </div>
              </article>
            `;
          })
          .join("");
      } else {
        elTextFeedWrap.hidden = true;
        elNewsTextList.innerHTML = "";
      }
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
    // 現在表示中のデータより古いデータには絶対に戻さない
    if (currentMs > 0 && candidateMs > 0 && candidateMs < currentMs) {
      return false;
    }
    // 同時刻で件数が減る場合も上書きしない
    if (currentMs > 0 && candidateMs === currentMs && candidate.items.length < (state.data?.items?.length || 0)) {
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
    const fetchFromApi = async () => {
      const apiUrl = `https://api.github.com/repos/sjhkazu1011-ctrl/morning-news-slides/contents/data/news.js?ref=main&_=${ts}`;
      const res = await fetchWithTimeout(apiUrl, { cache: "no-store" }, 3200);
      if (!res.ok) throw new Error("gh api fail");
      const meta = await res.json();
      if (!meta || typeof meta.content !== "string") throw new Error("gh api empty");
      const binStr = atob(meta.content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
      const text = new TextDecoder("utf-8").decode(bytes);
      const parsed = parseNewsJsText(text);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) return parsed;
      throw new Error("gh api invalid");
    };

    const fetchFromUrl = async (url) => {
      const res = await fetchWithTimeout(url, { cache: "no-store" }, 3000);
      if (!res.ok) throw new Error("url fail");
      const text = await res.text();
      const parsed = parseNewsJsText(text);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) return parsed;
      throw new Error("url invalid");
    };

    // 3系統を並列取得し、古いCDNキャッシュではなく最も新しいupdatedAtのデータを採用
    const results = await Promise.allSettled([
      fetchFromApi(),
      fetchFromUrl(`https://raw.githubusercontent.com/sjhkazu1011-ctrl/morning-news-slides/main/data/news.js?t=${ts}`),
      fetchFromUrl(`data/news.js?t=${ts}`),
    ]);

    let best = null;
    let bestMs = -1;
    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const ms = parseUpdatedAtMs(r.value.updatedAt);
      if (ms > bestMs || (ms === bestMs && r.value.items.length > (best?.items?.length || 0))) {
        best = r.value;
        bestMs = ms;
      }
    }
    return best;
  }

  async function fetchRssViaRss2Json(rssUrl, category, sourceFallback, limit) {
    const ts = Date.now();
    const r2jUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&_=${ts}`;
    const res = await fetchWithTimeout(r2jUrl, { cache: "no-store" }, 3200);
    if (!res.ok) throw new Error("rss2json fail");
    const data = await res.json();
    if (!data || !Array.isArray(data.items) || data.items.length === 0) throw new Error("rss2json empty");
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

  async function fetchRssViaAllOrigins(rssUrl, category, sourceFallback, limit) {
    const ts = Date.now();
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}&_=${ts}`;
    const res = await fetchWithTimeout(proxyUrl, { cache: "no-store" }, 3500);
    if (!res.ok) throw new Error("allorigins fail");
    const xmlText = await res.text();
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const isAtom = doc.documentElement?.localName === "feed";
    const nodes = Array.from(doc.querySelectorAll(isAtom ? "entry" : "item")).slice(0, limit);
    if (nodes.length === 0) throw new Error("xml empty");
    return nodes.map((node, idx) => {
      const title = (node.querySelector("title")?.textContent || "").trim();
      let link = "";
      if (isAtom) {
        link = node.querySelector('link[rel="alternate"]')?.getAttribute("href") || node.querySelector("link")?.getAttribute("href") || "";
      } else {
        link = (node.querySelector("link")?.textContent || "").trim();
      }
      const pubRaw =
        node.querySelector("pubDate, published, updated")?.textContent ||
        node.getElementsByTagName("dc:date")?.[0]?.textContent ||
        "";
      const pubMs = pubRaw ? Date.parse(pubRaw) : Date.now();
      const publishedTs = Number.isFinite(pubMs) ? Math.floor(pubMs / 1000) : Math.floor(Date.now() / 1000);
      const hatenaImg = node.getElementsByTagName("hatena:imageurl")?.[0]?.textContent || "";
      const desc = node.querySelector("description, summary, content")?.textContent || "";
      return {
        category,
        title,
        url: link.trim(),
        source: sourceFallback,
        publishedTs,
        publishedAt: formatNowJst().updatedAt,
        rawThumb: hatenaImg.startsWith("https://") ? hatenaImg : "",
        rawDesc: desc,
        idx,
      };
    });
  }

  async function fetchRssItemsFast(rssUrl, category, sourceFallback, limit) {
    try {
      return await Promise.any([
        fetchRssViaRss2Json(rssUrl, category, sourceFallback, limit),
        fetchRssViaAllOrigins(rssUrl, category, sourceFallback, limit),
      ]);
    } catch (_e) {
      return [];
    }
  }

  async function fetchLiveOgForUrl(url) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const res = await fetchWithTimeout(proxyUrl, {}, 2600);
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

  function enrichNewImagesInBackground(newTargets) {
    if (!newTargets || newTargets.length === 0) return;
    Promise.allSettled(
      newTargets.slice(0, 12).map(async (target) => {
        const og = await fetchLiveOgForUrl(target.url);
        let changed = false;
        if (og.image) {
          target.item.image = og.image;
          changed = true;
        }
        if (og.summary && og.summary.length >= 20 && target.item.summary.includes("に関する注目ニュースです")) {
          target.item.summary = og.summary.endsWith("。") ? og.summary : og.summary + "…";
          changed = true;
        }
        return changed;
      })
    ).then((results) => {
      const anyUpdated = results.some((r) => r.status === "fulfilled" && r.value === true);
      if (anyUpdated) {
        try {
          localStorage.setItem("trend-news-live-cache", JSON.stringify(state.data));
        } catch (_e) {}
        if (state.category !== "weather") {
          renderFeed();
        }
      }
    });
  }

  async function fetchLiveBrowserNews(baseData) {
    const existingByUrl = new Map();
    const existingByTitle = new Map();
    (baseData?.items || []).forEach((it) => {
      if (it?.url) existingByUrl.set(it.url, it);
      if (it?.title) existingByTitle.set(it.title, it);
    });

    const [
      domYahoo,
      domHatena,
      techYahoo,
      techHatena,
      bizYahoo,
      bizHatena,
      entYahoo,
      entHatena,
      subGame,
      subAuto,
      subComic,
      subVtuber,
    ] = await Promise.all([
      fetchRssItemsFast("https://news.yahoo.co.jp/rss/topics/domestic.xml", "domestic", "Yahoo!ニュース", 10),
      fetchRssItemsFast("https://b.hatena.ne.jp/hotentry/social.rss", "domestic", "はてなブックマーク", 25),
      fetchRssItemsFast("https://news.yahoo.co.jp/rss/topics/it.xml", "tech", "Yahoo!ニュース", 10),
      fetchRssItemsFast("https://b.hatena.ne.jp/hotentry/it.rss", "tech", "はてなブックマーク", 25),
      fetchRssItemsFast("https://news.yahoo.co.jp/rss/topics/business.xml", "business", "Yahoo!ニュース", 10),
      fetchRssItemsFast("https://b.hatena.ne.jp/hotentry/economics.rss", "business", "はてなブックマーク", 25),
      fetchRssItemsFast("https://news.yahoo.co.jp/rss/topics/entertainment.xml", "entertainment", "Yahoo!ニュース", 10),
      fetchRssItemsFast("https://b.hatena.ne.jp/hotentry/entertainment.rss", "entertainment", "はてなブックマーク", 25),
      fetchRssItemsFast("https://b.hatena.ne.jp/hotentry/game.rss", "subculture", "はてなブックマーク", 20),
      fetchRssItemsFast("https://automaton-media.com/feed/", "subculture", "AUTOMATON", 8),
      fetchRssItemsFast("https://natalie.mu/comic/feed/news", "subculture", "コミックナタリー", 8),
      fetchRssItemsFast("https://panora.tokyo/feed/", "subculture", "PANORA", 8),
    ]);

    const totalFetched =
      domYahoo.length +
      domHatena.length +
      techYahoo.length +
      techHatena.length +
      bizYahoo.length +
      bizHatena.length +
      entYahoo.length +
      entHatena.length +
      subGame.length +
      subAuto.length +
      subComic.length +
      subVtuber.length;
    if (totalFetched === 0) return null;

    const seen = new Set();
    const bgOgTargets = [];

    function buildCategoryList(rawCandidates, existingCatItems, catKey) {
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
          const img = raw.rawThumb || getFallbackImage({ category: catKey }, list.length);
          let summary = raw.rawDesc
            ? raw.rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            : `「${raw.title}」に関する注目ニュースです。詳細は元記事から確認できます。`;
          if (summary.length > 150) summary = summary.slice(0, 149) + "…";

          const itemObj = {
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
          };
          list.push(itemObj);
          if (!raw.rawThumb && list.length <= 10) {
            bgOgTargets.push({ url: raw.url, item: itemObj });
          }
        }
        if (list.length >= 30) break;
      }

      for (const oldIt of existingCatItems) {
        if (list.length >= 30) break;
        if (!seen.has(oldIt.url) && !seen.has(oldIt.title)) {
          seen.add(oldIt.url);
          seen.add(oldIt.title);
          list.push(oldIt);
        }
      }
      return list;
    }

    const oldItems = baseData?.items || [];
    const domList = buildCategoryList([...domYahoo, ...domHatena], oldItems.filter((i) => i.category === "domestic"), "domestic");
    const techList = buildCategoryList([...techYahoo, ...techHatena], oldItems.filter((i) => i.category === "tech"), "tech");
    const bizList = buildCategoryList([...bizYahoo, ...bizHatena], oldItems.filter((i) => i.category === "business"), "business");
    const entList = buildCategoryList([...entYahoo, ...entHatena], oldItems.filter((i) => i.category === "entertainment"), "entertainment");

    const subInterleaved = [];
    const subBuckets = [subAuto, subComic, subVtuber, subGame].map((arr) => [...arr]);
    while (subBuckets.some((b) => b.length > 0)) {
      for (const b of subBuckets) {
        if (b.length > 0) subInterleaved.push(b.shift());
      }
    }
    const subList = buildCategoryList(subInterleaved, oldItems.filter((i) => i.category === "subculture"), "subculture");

    const interleaved = [];
    const buckets = [domList, techList, bizList, entList, subList];
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
      payload: {
        date: nowJst.date,
        updatedAt: nowJst.updatedAt,
        title: "TREND NEWS",
        keywords,
        items: interleaved,
      },
      bgOgTargets,
    };
  }

  async function reloadNewsData(isManual = false) {
    if (state.isReloading) return;
    state.isReloading = true;
    elBtnRefresh.classList.add("spinning");

    try {
      if (state.category === "weather" && isManual) {
        await fetchAndRenderAllWeather(true);
        return;
      }

      // Step 1: GitHub API / raw / local を並列レースで最速取得
      const ghData = await fetchGithubNewsData();
      if (ghData) {
        applyNewsDataIfNewer(ghData, isManual);
      }

      // Step 2: 5分以上古い場合または手動更新時は、ブラウザから直接RSSを並列高速取得して即描画
      const ageMs = Date.now() - parseUpdatedAtMs(state.data?.updatedAt);
      if (isManual || ageMs >= 5 * 60 * 1000) {
        const liveRes = await fetchLiveBrowserNews(state.data);
        if (liveRes && liveRes.payload) {
          applyNewsDataIfNewer(liveRes.payload, true);
          // OGP画像取得は描画をブロックせず裏で並列差し替え
          enrichNewImagesInBackground(liveRes.bgOgTargets);
        } else if (isManual) {
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

  // Weather Dedicated Section (現在地 + 日本の主要都市一括取得)
  const elWeatherCurrentWrap = document.getElementById("weather-current-wrap");
  const elWeatherCitiesGrid = document.getElementById("weather-cities-grid");
  const elWeatherUpdatedLabel = document.getElementById("weather-updated-label");

  const MAJOR_JP_CITIES = [
    { name: "札幌", region: "北海道", lat: 43.0618, lon: 141.3545 },
    { name: "仙台", region: "東北", lat: 38.2682, lon: 140.8694 },
    { name: "東京", region: "関東", lat: 35.6812, lon: 139.7671 },
    { name: "横浜", region: "関東", lat: 35.4437, lon: 139.638 },
    { name: "新潟", region: "北陸", lat: 37.9161, lon: 139.0364 },
    { name: "金沢", region: "北陸", lat: 36.5613, lon: 136.6562 },
    { name: "名古屋", region: "東海", lat: 35.1815, lon: 136.9066 },
    { name: "大阪", region: "近畿", lat: 34.6937, lon: 135.5023 },
    { name: "広島", region: "中国", lat: 34.3853, lon: 132.4553 },
    { name: "高松", region: "四国", lat: 34.3428, lon: 134.0466 },
    { name: "福岡", region: "九州", lat: 33.5902, lon: 130.4017 },
    { name: "那覇", region: "沖縄", lat: 26.2124, lon: 127.6809 },
  ];

  const weatherState = {
    lastFetchAt: 0,
    isFetching: false,
    currentLoc: null, // { lat, lon, locName, isFallback? }
  };

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

  function getSavedLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem("trend-news-geo") || "null");
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
        return { lat: saved.lat, lon: saved.lon, locName: saved.locName || "現在地", isFallback: false };
      }
    } catch (_e) {}
    return { lat: 35.6812, lon: 139.7671, locName: "東京（デフォルト）", isFallback: true };
  }

  async function resolveLocationName(lat, lon) {
    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`;
      const res = await fetchWithTimeout(url, {}, 4000);
      if (!res.ok) return "現在地";
      const data = await res.json();
      const city = data.city || data.locality || data.principalSubdivision || "現在地";
      return city.replace(/^(東京都|大阪府|京都府|北海道)/, "$1 ");
    } catch (_e) {
      return "現在地";
    }
  }

  async function searchCityCoords(cityName) {
    const q = cityName.trim();
    if (!q) return null;
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ja&format=json`;
      const res = await fetchWithTimeout(url, {}, 5000);
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

  async function promptManualCityWeather() {
    const input = window.prompt(
      "天気を表示したい市区町村名（例: 横浜市、大阪市、札幌市、新宿区）を入力してください:",
      ""
    );
    if (!input) return;
    if (elWeatherUpdatedLabel) elWeatherUpdatedLabel.textContent = "地域を検索中...";
    const found = await searchCityCoords(input);
    if (found) {
      localStorage.setItem("trend-news-geo", JSON.stringify(found));
      weatherState.currentLoc = { ...found, isFallback: false };
      await fetchAndRenderAllWeather(true);
    } else if (elWeatherUpdatedLabel) {
      elWeatherUpdatedLabel.textContent = "地域が見つかりませんでした";
    }
  }

  function requestGeolocationAndRefresh(isUserTap = false) {
    if (!navigator.geolocation) {
      if (isUserTap) promptManualCityWeather();
      return;
    }
    if (isUserTap && elWeatherUpdatedLabel) {
      elWeatherUpdatedLabel.textContent = "現在地を測位中...";
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const locName = await resolveLocationName(lat, lon);
        const geo = { lat, lon, locName };
        localStorage.setItem("trend-news-geo", JSON.stringify(geo));
        weatherState.currentLoc = { ...geo, isFallback: false };
        await fetchAndRenderAllWeather(true);
      },
      async () => {
        if (isUserTap) {
          await promptManualCityWeather();
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }

  function parseWeatherItem(entry) {
    const temp = Math.round(entry?.current?.temperature_2m ?? 0);
    const code = entry?.current?.weather_code ?? 0;
    const wind = Math.round(entry?.current?.wind_speed_10m ?? 0);
    const meta = getWeatherMeta(code);
    const maxTemp = Math.round(entry?.daily?.temperature_2m_max?.[0] ?? temp);
    const minTemp = Math.round(entry?.daily?.temperature_2m_min?.[0] ?? temp);
    const pop = entry?.daily?.precipitation_probability_max?.[0] ?? 0;
    return { temp, wind, meta, maxTemp, minTemp, pop };
  }

  function renderCurrentWeatherCard(loc, w) {
    if (!elWeatherCurrentWrap) return;
    elWeatherCurrentWrap.innerHTML = `
      <div class="weather-current-card">
        <div class="weather-current-main">
          <div class="weather-current-icon">${w.meta.icon}</div>
          <div>
            <div class="weather-current-loc-badge">📍 現在地の天気</div>
            <div class="weather-current-city">${escapeHtml(loc.locName)}</div>
            <div class="weather-current-desc">${escapeHtml(w.meta.label)}・最高 ${w.maxTemp}°C / 最低 ${w.minTemp}°C</div>
          </div>
        </div>
        <div class="weather-current-stats">
          <div class="weather-current-temp">${w.temp}°C</div>
          <div class="weather-current-details">
            <span>☔ 降水確率: ${w.pop}%</span>
            <span>🍃 風速: ${w.wind} km/h</span>
          </div>
          <div class="weather-loc-actions">
            <button type="button" class="weather-action-btn" id="btn-weather-gps">📍 現在地を再取得</button>
            <button type="button" class="weather-action-btn" id="btn-weather-city">🏙️ 都市名を指定</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById("btn-weather-gps")?.addEventListener("click", () => requestGeolocationAndRefresh(true));
    document.getElementById("btn-weather-city")?.addEventListener("click", () => promptManualCityWeather());
  }

  function renderCityWeatherCards(cityResults) {
    if (!elWeatherCitiesGrid) return;
    elWeatherCitiesGrid.innerHTML = cityResults
      .map(({ city, w }) => {
        return `
          <article class="weather-city-card">
            <div class="weather-city-top">
              <span class="weather-city-name">${escapeHtml(city.name)}</span>
              <span class="weather-city-region">${escapeHtml(city.region)}</span>
            </div>
            <div class="weather-city-mid">
              <span class="weather-city-icon">${w.meta.icon}</span>
              <div>
                <div class="weather-city-temp">${w.temp}°C</div>
                <div class="weather-city-label">${escapeHtml(w.meta.label)}</div>
              </div>
            </div>
            <div class="weather-city-meta">
              <span>最高 ${w.maxTemp}° / 最低 ${w.minTemp}°</span>
              <span>☔ ${w.pop}%</span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function fetchSingleLocationWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=1`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
    const data = await res.json();
    return parseWeatherItem(data);
  }

  async function fetchAndRenderAllWeather(forceRefresh = false) {
    if (weatherState.isFetching) return;
    if (!forceRefresh && Date.now() - weatherState.lastFetchAt < 10 * 60 * 1000 && weatherState.lastFetchAt > 0) {
      return;
    }
    weatherState.isFetching = true;
    if (elWeatherUpdatedLabel) elWeatherUpdatedLabel.textContent = "最新の天気を取得中...";

    try {
      const loc = weatherState.currentLoc || getSavedLocation();
      weatherState.currentLoc = loc;

      // 現在地と主要12都市を個別に並列取得（1本にまとめるとAPI側がタイムアウトするため）
      const currentPromise = fetchSingleLocationWeather(loc.lat, loc.lon);
      const cityPromises = MAJOR_JP_CITIES.map((city) =>
        fetchSingleLocationWeather(city.lat, city.lon).then((w) => ({ city, w }))
      );

      const currentSettled = await currentPromise.then(
        (w) => ({ ok: true, w }),
        () => ({ ok: false })
      );
      if (currentSettled.ok) {
        renderCurrentWeatherCard(loc, currentSettled.w);
      }

      const citySettledList = await Promise.allSettled(cityPromises);
      const cityResults = citySettledList
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      if (cityResults.length > 0) {
        renderCityWeatherCards(cityResults);
        weatherState.lastFetchAt = Date.now();
        if (elWeatherUpdatedLabel) {
          elWeatherUpdatedLabel.textContent = `更新: ${formatNowJst().updatedAt}`;
        }
      } else if (!currentSettled.ok) {
        if (elWeatherUpdatedLabel) elWeatherUpdatedLabel.textContent = "天気の取得に失敗しました（再試行してください）";
      }
    } catch (_err) {
      if (elWeatherUpdatedLabel) elWeatherUpdatedLabel.textContent = "天気の取得に失敗しました";
    } finally {
      weatherState.isFetching = false;
    }
  }

  function ensureWeatherLoadedAndRender() {
    if (!weatherState.currentLoc) {
      weatherState.currentLoc = getSavedLocation();
      if (weatherState.currentLoc.isFallback) {
        requestGeolocationAndRefresh(false);
      }
    }
    fetchAndRenderAllWeather(false);
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
  state.lastDataSignature = computeDataSignature(state.data);
  restoreCachedNewsOnStartup();
  renderAll();
  reloadNewsData(false);
  setInterval(() => reloadNewsData(false), 5 * 60 * 1000);
  setInterval(() => {
    if (state.category === "weather") fetchAndRenderAllWeather(true);
  }, 30 * 60 * 1000);
})();

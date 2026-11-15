(() => {
  const CATEGORY_META = {
    all: { label: "トップ", icon: "🔥" },
    domestic: { label: "国内・総合", icon: "🇯🇵" },
    tech: { label: "テクノロジー・AI", icon: "🤖" },
    business: { label: "ビジネス・経済", icon: "📈" },
    entertainment: { label: "芸能・エンタメ", icon: "🎬" },
    subculture: { label: "サブカルチャー", icon: "🎮" },
    saved: { label: "保存済み", icon: "⭐" },
    weather: { label: "天気", icon: "☀️" },
  };

  const DEFAULT_CATEGORY_ORDER = [
    "all",
    "domestic",
    "tech",
    "business",
    "entertainment",
    "subculture",
    "saved",
    "weather",
  ];
  const MAX_ARTICLE_AGE_SEC = 24 * 3600;
  const VALID_CATEGORIES = new Set(DEFAULT_CATEGORY_ORDER);
  const CATEGORY_STORAGE_KEY = "trend-news-active-category";
  const WEATHER_CACHE_KEY = "trend-news-weather-cities-v1";
  const BOOKMARKS_STORAGE_KEY = "trend-news-bookmarks";
  const READ_URLS_STORAGE_KEY = "trend-news-read-urls";
  const MY_TOPICS_STORAGE_KEY = "trend-news-my-topics";
  const FONT_SIZE_STORAGE_KEY = "trend-news-font-size";
  const CAT_PREFS_STORAGE_KEY = "trend-news-category-prefs";

  const DEFAULT_WEATHER_CITIES = [
    { name: "札幌", region: "北海道", temp: 7, code: 3, wind: 4, maxTemp: 9, minTemp: 2, pop: 20 },
    { name: "仙台", region: "東北", temp: 12, code: 2, wind: 5, maxTemp: 14, minTemp: 7, pop: 20 },
    { name: "新潟", region: "北陸", temp: 13, code: 2, wind: 6, maxTemp: 15, minTemp: 9, pop: 30 },
    { name: "金沢", region: "北陸", temp: 15, code: 2, wind: 4, maxTemp: 17, minTemp: 10, pop: 30 },
    { name: "東京", region: "関東", temp: 15, code: 1, wind: 4, maxTemp: 17, minTemp: 10, pop: 10 },
    { name: "名古屋", region: "東海", temp: 16, code: 1, wind: 3, maxTemp: 18, minTemp: 10, pop: 10 },
    { name: "大阪", region: "近畿", temp: 17, code: 1, wind: 3, maxTemp: 19, minTemp: 12, pop: 10 },
    { name: "広島", region: "中国", temp: 18, code: 1, wind: 4, maxTemp: 20, minTemp: 12, pop: 10 },
    { name: "高知", region: "四国", temp: 19, code: 1, wind: 4, maxTemp: 21, minTemp: 13, pop: 10 },
    { name: "福岡", region: "九州", temp: 18, code: 2, wind: 6, maxTemp: 20, minTemp: 13, pop: 20 },
    { name: "那覇", region: "沖縄", temp: 24, code: 1, wind: 10, maxTemp: 26, minTemp: 21, pop: 10 },
  ];

  const INITIAL_BUNDLED_WEATHER_CITIES = Array.isArray(window.NEWS_DATA?.weatherCities)
    ? window.NEWS_DATA.weatherCities.map((c) => ({ ...c }))
    : [];
  const INITIAL_BUNDLED_UPDATED_AT = window.NEWS_DATA?.updatedAt || "";

  function safeStorageGet(storage, key) {
    try {
      if (typeof storage !== "undefined" && storage) {
        return storage.getItem(key);
      }
    } catch (_e) {}
    return null;
  }

  function safeStorageSet(storage, key, val) {
    try {
      if (typeof storage !== "undefined" && storage) {
        storage.setItem(key, String(val));
      }
    } catch (_e) {}
  }

  function getSavedCategory() {
    const s = safeStorageGet(typeof sessionStorage !== "undefined" ? sessionStorage : null, CATEGORY_STORAGE_KEY);
    if (s && VALID_CATEGORIES.has(s)) return s;
    const l = safeStorageGet(typeof localStorage !== "undefined" ? localStorage : null, CATEGORY_STORAGE_KEY);
    if (l && VALID_CATEGORIES.has(l)) return l;
    return "all";
  }

  function saveCategory(cat) {
    if (!VALID_CATEGORIES.has(cat)) return;
    safeStorageSet(typeof sessionStorage !== "undefined" ? sessionStorage : null, CATEGORY_STORAGE_KEY, cat);
    safeStorageSet(typeof localStorage !== "undefined" ? localStorage : null, CATEGORY_STORAGE_KEY, cat);
  }

  function loadJsonFromStorage(key, fallbackVal) {
    try {
      const raw = safeStorageGet(typeof localStorage !== "undefined" ? localStorage : null, key);
      if (!raw) return fallbackVal;
      const parsed = JSON.parse(raw);
      return parsed ?? fallbackVal;
    } catch (_e) {
      return fallbackVal;
    }
  }

  function loadInitialCatPrefs() {
    const raw = loadJsonFromStorage(CAT_PREFS_STORAGE_KEY, null);
    const savedOrder = Array.isArray(raw?.order) ? raw.order.filter((c) => VALID_CATEGORIES.has(c)) : [];
    const mergedOrder = [
      ...savedOrder,
      ...DEFAULT_CATEGORY_ORDER.filter((c) => !savedOrder.includes(c)),
    ];
    const hidden = Array.isArray(raw?.hidden)
      ? raw.hidden.filter((c) => c !== "all" && VALID_CATEGORIES.has(c))
      : [];
    return { order: mergedOrder, hidden };
  }

  const initialBookmarks = loadJsonFromStorage(BOOKMARKS_STORAGE_KEY, []).filter(
    (b) => b && typeof b.url === "string" && b.url && b.title
  );
  const initialMyTopics = loadJsonFromStorage(MY_TOPICS_STORAGE_KEY, []).filter(
    (t) => typeof t === "string" && t.trim()
  );

  const state = {
    data: window.NEWS_DATA || { date: "--", updatedAt: "--", keywords: [], weatherCities: DEFAULT_WEATHER_CITIES, items: [] },
    category: getSavedCategory(),
    query: "",
    unreadOnly: false,
    isReloading: false,
    lastDataSignature: "",
    currentModalItem: null,
    bookmarks: initialBookmarks,
    bookmarkUrls: new Set(initialBookmarks.map((b) => b.url)),
    readUrls: new Set(loadJsonFromStorage(READ_URLS_STORAGE_KEY, []).filter((u) => typeof u === "string")),
    myTopics: initialMyTopics,
    myTopicsPairs: initialMyTopics.map((t) => ({ raw: t.trim(), lower: t.trim().toLowerCase() })),
    fontSize: safeStorageGet(typeof localStorage !== "undefined" ? localStorage : null, FONT_SIZE_STORAGE_KEY) || "normal",
    catPrefs: loadInitialCatPrefs(),
  };

  function syncMyTopicsPairs() {
    state.myTopicsPairs = (state.myTopics || [])
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .map((raw) => ({ raw, lower: raw.toLowerCase() }));
  }

  // DOM
  const elHeaderUpdated = document.getElementById("header-updated");
  const elSearchInput = document.getElementById("search-input");
  const elSearchClear = document.getElementById("search-clear");
  const elBtnFontSize = document.getElementById("btn-font-size");
  const elBtnSettings = document.getElementById("btn-settings");
  const elBtnRefresh = document.getElementById("btn-refresh");
  const elBtnTheme = document.getElementById("btn-theme");
  const elBrandReset = document.getElementById("brand-reset");
  const elBtnWeatherShortcut = document.getElementById("btn-weather-shortcut");
  const elHeaderWeatherIcon = document.getElementById("header-weather-icon");
  const elCategoryNav = document.getElementById("category-nav");
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
  const elBtnUnreadOnly = document.getElementById("btn-unread-only");
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
  const elSettingsModal = document.getElementById("settings-modal");
  const elSettingsBackdrop = document.getElementById("settings-backdrop");
  const elSettingsClose = document.getElementById("settings-close");
  const elFontSizeOptions = document.getElementById("font-size-options");
  const elMyTopicInput = document.getElementById("my-topic-input");
  const elBtnAddTopic = document.getElementById("btn-add-topic");
  const elMyTopicsList = document.getElementById("my-topics-list");
  const elCategoryOrderList = document.getElementById("category-order-list");
  const elBtnResetPrefs = document.getElementById("btn-reset-prefs");
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
    return CATEGORY_META[cat] || { label: "ニュース", icon: "📰" };
  }

  function getItemPublishedTs(item) {
    const ts = Number(item?.publishedTs);
    if (Number.isFinite(ts) && ts > 0) return ts;
    if (typeof item?.publishedAt === "string" && item.publishedAt.trim()) {
      const normalized = item.publishedAt.trim().replace(/\//g, "-").replace(" ", "T");
      const ms = Date.parse(/[zZ]|[+\-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+09:00`);
      if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);
    }
    return 0;
  }

  function isArticleWithin24Hours(item, nowSec = Math.floor(Date.now() / 1000)) {
    const ts = getItemPublishedTs(item);
    if (ts <= 0) return false;
    const ageSec = nowSec - ts;
    return ageSec >= -3600 && ageSec < MAX_ARTICLE_AGE_SEC;
  }

  function formatJstFromTs(tsSec) {
    if (!Number.isFinite(tsSec) || tsSec <= 0) return "";
    const jst = new Date((tsSec + 9 * 3600) * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
  }

  function isGenericOrSampleImageUrl(url) {
    if (typeof url !== "string") return true;
    const trimmed = url.trim();
    if (!trimmed || (!trimmed.startsWith("https://") && !trimmed.startsWith("http://"))) {
      return true;
    }
    const lower = trimmed.toLowerCase();
    const badTokens = [
      "assets/images/",
      "ogp_default",
      "default_ogp",
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
      "news-pctr.c.yimg.jp/e/",
      "default.jpg",
      "default.png",
      "amd-img/default",
      ".svg",
    ];
    return badTokens.some((tok) => lower.includes(tok));
  }

  function buildRelatedImageQuery(item) {
    let title = String(item?.title || "").trim();
    title = title.replace(/\s*[-｜|—–]\s*[^-｜|—–]{1,28}$/, "").trim();
    const stop = new Set(["news", "yahoo", "itmedia", "zenn", "qiita", "note", "topics", "2026", "2025", "http", "https"]);
    const tokens = (title.match(/[一-龥ァ-ヶーa-zA-Z0-9]{2,}/g) || []).filter(
      (t) => !stop.has(t.toLowerCase())
    );
    let query = tokens.slice(0, 6).join(" ").trim();
    if (!query) query = title.slice(0, 48).trim();
    if (query.length > 64) query = query.slice(0, 64).trim();
    if (!query) {
      const catLabel = getCategoryMeta(item?.category).label || "ニュース";
      return `${catLabel} ニュース`;
    }
    return query;
  }

  function getRelatedWebImageUrl(item) {
    const query = buildRelatedImageQuery(item);
    const encoded = encodeURIComponent(query).replace(/'/g, "%27");
    return `https://tse2.mm.bing.net/th?q=${encoded}&w=800&h=450&c=7&rs=1&p=0`;
  }

  function getFallbackImage(item, _index = 0) {
    return getRelatedWebImageUrl(item);
  }

  function getSafeImageUrl(item, _index = 0) {
    const raw = typeof item?.image === "string" ? item.image.trim() : "";
    if (!isGenericOrSampleImageUrl(raw)) {
      return raw;
    }
    return getRelatedWebImageUrl(item);
  }

  function normalizeNewsItems(items) {
    if (!Array.isArray(items)) return [];
    const nowSec = Math.floor(Date.now() / 1000);
    return items
      .filter((it) => it && isArticleWithin24Hours(it, nowSec))
      .map((it) => {
        const safeImg = getSafeImageUrl(it);
        return it.image === safeImg ? it : { ...it, image: safeImg };
      });
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

  function syncHeaderWeatherIcon(iconOverride) {
    if (!elHeaderWeatherIcon) return;
    if (iconOverride) {
      elHeaderWeatherIcon.textContent = iconOverride;
      return;
    }
    const cities = Array.isArray(state.data?.weatherCities) ? state.data.weatherCities : [];
    const saved = loadJsonFromStorage("trend-news-geo", null);
    const matchCity =
      (saved?.locName && cities.find((c) => saved.locName.includes(c.name))) ||
      cities.find((c) => c.name === "東京") ||
      cities[0];
    if (matchCity && Number.isFinite(matchCity.code)) {
      elHeaderWeatherIcon.textContent = getWeatherMeta(matchCity.code).icon;
    }
  }

  // Bookmarks, Read Status, My Topics, Font Size & Category Prefs
  function isBookmarked(url) {
    return Boolean(url && state.bookmarkUrls.has(url));
  }

  function findArticleByUrl(url) {
    if (!url) return null;
    const fromData = (Array.isArray(state.data.items) ? state.data.items : []).find((it) => it && it.url === url);
    if (fromData) return fromData;
    const fromSaved = state.bookmarks.find((b) => b && b.url === url);
    if (fromSaved) return fromSaved;
    if (state.currentModalItem && state.currentModalItem.url === url) {
      return state.currentModalItem;
    }
    return null;
  }

  function toggleBookmarkByUrl(url) {
    if (!url) return false;
    const existingIdx = state.bookmarks.findIndex((b) => b.url === url);
    let nowSaved = false;
    if (existingIdx >= 0) {
      state.bookmarks.splice(existingIdx, 1);
      state.bookmarkUrls.delete(url);
      nowSaved = false;
    } else {
      const item = findArticleByUrl(url);
      if (item) {
        const cleanCopy = {
          category: item.category || "domestic",
          title: item.title,
          source: item.source || "",
          publishedAt: item.publishedAt || "",
          publishedTs: item.publishedTs || Math.floor(Date.now() / 1000),
          image: getSafeImageUrl(item),
          summary: item.summary || "",
          points: Array.isArray(item.points) ? item.points : [],
          impact: item.impact || "",
          tags: Array.isArray(item.tags) ? item.tags : [],
          url: item.url,
          savedAt: Date.now(),
        };
        state.bookmarks.unshift(cleanCopy);
        state.bookmarkUrls.add(url);
        nowSaved = true;
      }
    }
    safeStorageSet(localStorage, BOOKMARKS_STORAGE_KEY, JSON.stringify(state.bookmarks.slice(0, 200)));
    if (state.category === "saved") {
      renderFeed();
    } else if (elMainContainer && typeof elMainContainer.querySelectorAll === "function") {
      elMainContainer.querySelectorAll("[data-bookmark-url]").forEach((btn) => {
        if (btn.getAttribute("data-bookmark-url") === url) {
          btn.classList.toggle("active", nowSaved);
          btn.textContent = nowSaved ? "★" : "☆";
          btn.setAttribute("title", nowSaved ? "保存を解除" : "あとで読むに保存");
        }
      });
    }
    return nowSaved;
  }

  function markArticleRead(url) {
    if (!url || state.readUrls.has(url)) return;
    state.readUrls.add(url);
    const list = Array.from(state.readUrls).slice(-500);
    safeStorageSet(localStorage, READ_URLS_STORAGE_KEY, JSON.stringify(list));
    if (state.unreadOnly) {
      renderFeed();
      return;
    }
    if (elMainContainer && typeof elMainContainer.querySelectorAll === "function") {
      elMainContainer.querySelectorAll("[data-article-url]").forEach((card) => {
        if (card.getAttribute("data-article-url") === url) {
          card.classList.add("is-read");
          const metaRow = card.querySelector?.(".meta-row");
          if (metaRow && !metaRow.querySelector?.(".read-badge") && typeof document.createElement === "function") {
            const badge = document.createElement("span");
            badge.className = "read-badge";
            badge.textContent = "既読";
            const anchor = metaRow.querySelector?.(".my-topic-badge") || metaRow.querySelector?.(".cat-pill");
            if (anchor && anchor.nextSibling && typeof metaRow.insertBefore === "function") {
              metaRow.insertBefore(badge, anchor.nextSibling);
            } else if (typeof metaRow.appendChild === "function") {
              metaRow.appendChild(badge);
            }
          }
        }
      });
    }
  }

  function getMatchedMyTopic(item) {
    if (!state.myTopicsPairs || state.myTopicsPairs.length === 0 || !item) return "";
    const hay = [
      item.title,
      item.summary,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ]
      .join(" ")
      .toLowerCase();
    for (const pair of state.myTopicsPairs) {
      if (hay.includes(pair.lower)) {
        return pair.raw;
      }
    }
    return "";
  }

  function applyFontSize(size) {
    const valid = size === "large" || size === "xlarge" ? size : "normal";
    state.fontSize = valid;
    document.documentElement.setAttribute("data-font-size", valid);
    safeStorageSet(localStorage, FONT_SIZE_STORAGE_KEY, valid);
    if (elBtnFontSize) {
      elBtnFontSize.classList.toggle("active", valid !== "normal");
      const labelMap = { normal: "標準", large: "大きめ", xlarge: "特大" };
      elBtnFontSize.setAttribute("title", `文字サイズ: ${labelMap[valid]}（クリックで切替）`);
    }
    if (elFontSizeOptions && typeof elFontSizeOptions.querySelectorAll === "function") {
      elFontSizeOptions.querySelectorAll("[data-set-font]").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-set-font") === valid);
      });
    }
  }

  function cycleFontSize() {
    const order = ["normal", "large", "xlarge"];
    const next = order[(order.indexOf(state.fontSize) + 1) % order.length];
    applyFontSize(next);
  }

  function applyCategoryPreferences() {
    const { order, hidden } = state.catPrefs;
    const hiddenSet = new Set(hidden);
    const tabsByCat = new Map();
    navTabs.forEach((tab) => {
      const c = tab.getAttribute("data-category");
      if (c) tabsByCat.set(c, tab);
    });
    order.forEach((cat) => {
      const tab = tabsByCat.get(cat);
      if (!tab) return;
      const isHidden = cat !== "all" && hiddenSet.has(cat);
      tab.hidden = isHidden;
      if (elCategoryNav && typeof elCategoryNav.appendChild === "function") {
        elCategoryNav.appendChild(tab);
      }
    });
    if (hiddenSet.has(state.category)) {
      state.category = "all";
      saveCategory("all");
    }
  }

  function getActiveCategoryOrder() {
    const hiddenSet = new Set(state.catPrefs.hidden);
    return state.catPrefs.order.filter((c) => c === "all" || !hiddenSet.has(c));
  }

  function renderTrending() {
    const keywords = Array.isArray(state.data.keywords) ? state.data.keywords : [];
    const currentQ = state.query.trim().toLowerCase();

    const myTopicChips = state.myTopics.map((topic) => {
      const active = currentQ && currentQ === topic.toLowerCase() ? "active" : "";
      return `<button type="button" class="trending-chip my-topic-chip ${active}" data-kw="${escapeHtml(topic)}">📌 ${escapeHtml(topic)}</button>`;
    });

    const kwChips = keywords.map((kw) => {
      const searchVal = normalizeKeywordQuery(kw);
      const active = currentQ && currentQ === searchVal.toLowerCase() ? "active" : "";
      return `<button type="button" class="trending-chip ${active}" data-kw="${escapeHtml(searchVal)}"># ${escapeHtml(kw)}</button>`;
    });

    const manageBtn = `<button type="button" class="trending-chip my-topic-manage-chip" data-open-settings="1">＋ マイトピック登録</button>`;
    elTrendingTags.innerHTML = [...myTopicChips, ...kwChips, manageBtn].join("");
  }

  function renderHero(items) {
    const lead = items[0];
    const sideItems = items.slice(1, 5);
    const leadMeta = getCategoryMeta(lead.category);
    const leadImg = getSafeImageUrl(lead);
    const leadFallback = getFallbackImage(lead);
    const leadSaved = isBookmarked(lead.url);
    const leadRead = Boolean(lead.url && state.readUrls.has(lead.url));
    const leadTopic = getMatchedMyTopic(lead);

    elHeroLead.innerHTML = `
      <article class="hero-card ${leadRead ? "is-read" : ""} ${leadTopic ? "is-my-topic" : ""}" data-article-idx="${lead._idx}" data-article-url="${escapeHtml(lead.url || "")}">
        <div class="hero-image-wrap">
          <img src="${escapeHtml(leadImg)}" data-fallback-src="${escapeHtml(leadFallback)}" alt="${escapeHtml(lead.title)}" referrerpolicy="no-referrer" />
          <span class="hero-top-badge">TOP PICKUP</span>
          <button type="button" class="bookmark-btn ${leadSaved ? "active" : ""}" data-bookmark-url="${escapeHtml(lead.url || "")}" title="${leadSaved ? "保存を解除" : "あとで読むに保存"}" aria-label="ブックマーク切替">${leadSaved ? "★" : "☆"}</button>
        </div>
        <div class="hero-body">
          <div class="meta-row">
            <span class="cat-pill ${escapeHtml(lead.category)}">${leadMeta.icon} ${escapeHtml(leadMeta.label)}</span>
            ${leadTopic ? `<span class="my-topic-badge">📌 ${escapeHtml(leadTopic)}</span>` : ""}
            ${leadRead ? `<span class="read-badge">既読</span>` : ""}
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
      .map((item) => {
        const meta = getCategoryMeta(item.category);
        const img = getSafeImageUrl(item);
        const fb = getFallbackImage(item);
        const isSaved = isBookmarked(item.url);
        const isRead = Boolean(item.url && state.readUrls.has(item.url));
        const matchedTopic = getMatchedMyTopic(item);
        return `
          <div class="side-item ${isRead ? "is-read" : ""} ${matchedTopic ? "is-my-topic" : ""}" role="button" tabindex="0" data-article-idx="${item._idx}" data-article-url="${escapeHtml(item.url || "")}">
            <img class="side-thumb" src="${escapeHtml(img)}" data-fallback-src="${escapeHtml(fb)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <div class="side-item-body">
              <div class="meta-row">
                <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
                ${matchedTopic ? `<span class="my-topic-badge">📌 ${escapeHtml(matchedTopic)}</span>` : ""}
                ${isRead ? `<span class="read-badge">既読</span>` : ""}
                <span>${escapeHtml(formatRelativeTime(item))}</span>
              </div>
              <div class="side-item-title">${escapeHtml(item.title)}</div>
            </div>
            <button type="button" class="bookmark-btn ${isSaved ? "active" : ""}" data-bookmark-url="${escapeHtml(item.url || "")}" title="${isSaved ? "保存を解除" : "あとで読むに保存"}" aria-label="ブックマーク切替">${isSaved ? "★" : "☆"}</button>
          </div>
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

    const isSavedView = state.category === "saved" && !q;
    const rawItems = isSavedView
      ? state.bookmarks
      : Array.isArray(state.data.items)
        ? state.data.items
        : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const allWithIdx = rawItems
      .map((item, idx) => ({ ...item, _idx: isSavedView ? -1 : idx }))
      .filter((item) => (isSavedView ? true : isArticleWithin24Hours(item, nowSec)));

    if (q) {
      elFilterStatus.hidden = false;
      elFilterStatusText.textContent = `「${q}」の検索結果`;
    } else {
      elFilterStatus.hidden = true;
    }

    const qLower = q.toLowerCase();
    const filtered = allWithIdx.filter((item) => {
      if (state.unreadOnly && item.url && state.readUrls.has(item.url)) {
        return false;
      }
      if (
        !isSavedView &&
        state.category !== "all" &&
        state.category !== "weather" &&
        state.category !== "saved" &&
        item.category !== state.category
      ) {
        return false;
      }
      if (!qLower) return true;
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

    const isTopOverview = state.category === "all" && !q && !state.unreadOnly && filtered.length >= 5;
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
      elHeroLead.innerHTML = "";
      elHeroSideList.innerHTML = "";
      const meta = getCategoryMeta(state.category);
      elFeedHeading.textContent = q
        ? "検索結果"
        : state.category === "all"
          ? "注目のトレンド記事"
          : state.category === "saved"
            ? "⭐ 保存した記事（あとで読む）"
            : `${meta.icon} ${meta.label}のニュース`;
    }

    elFeedCount.textContent = `${filtered.length}件の記事`;
    if (elBtnUnreadOnly) {
      elBtnUnreadOnly.classList.toggle("active", state.unreadOnly);
      elBtnUnreadOnly.setAttribute("aria-pressed", String(state.unreadOnly));
    }

    if (gridItems.length === 0 && !isTopOverview) {
      const emptyMsg = isSavedView
        ? "保存した記事はまだありません。記事カードの「☆」ボタンからあとで読む記事を保存できます。"
        : state.unreadOnly
          ? "未読の記事はありません。「未読のみ」を解除するとすべての記事を表示します。"
          : "条件に一致するニュースが見つかりませんでした。";
      elNewsGrid.innerHTML = `
        <div class="empty-state">
          <p>${escapeHtml(emptyMsg)}</p>
        </div>
      `;
    } else {
      elNewsGrid.innerHTML = gridItems
        .map((item) => {
          const meta = getCategoryMeta(item.category);
          const img = getSafeImageUrl(item);
          const fb = getFallbackImage(item);
          const isSaved = isBookmarked(item.url);
          const isRead = Boolean(item.url && state.readUrls.has(item.url));
          const matchedTopic = getMatchedMyTopic(item);
          const tagsHtml = (Array.isArray(item.tags) ? item.tags : [])
            .slice(0, 3)
            .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
            .join("");

          return `
            <article class="news-card ${isRead ? "is-read" : ""} ${matchedTopic ? "is-my-topic" : ""}" data-article-idx="${item._idx}" data-article-url="${escapeHtml(item.url || "")}">
              <div class="card-thumb-wrap">
                <img src="${escapeHtml(img)}" data-fallback-src="${escapeHtml(fb)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" />
                <button type="button" class="bookmark-btn ${isSaved ? "active" : ""}" data-bookmark-url="${escapeHtml(item.url || "")}" title="${isSaved ? "保存を解除" : "あとで読むに保存"}" aria-label="ブックマーク切替">${isSaved ? "★" : "☆"}</button>
              </div>
              <div class="card-body">
                <div class="meta-row">
                  <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
                  ${matchedTopic ? `<span class="my-topic-badge">📌 ${escapeHtml(matchedTopic)}</span>` : ""}
                  ${isRead ? `<span class="read-badge">既読</span>` : ""}
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
            const isSaved = isBookmarked(item.url);
            const isRead = Boolean(item.url && state.readUrls.has(item.url));
            const matchedTopic = getMatchedMyTopic(item);
            return `
              <article class="text-news-item ${isRead ? "is-read" : ""} ${matchedTopic ? "is-my-topic" : ""}" data-article-idx="${item._idx}" data-article-url="${escapeHtml(item.url || "")}">
                <span class="text-news-rank">${rank}</span>
                <div class="text-news-body">
                  <div class="meta-row">
                    <span class="cat-pill ${escapeHtml(item.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
                    ${matchedTopic ? `<span class="my-topic-badge">📌 ${escapeHtml(matchedTopic)}</span>` : ""}
                    ${isRead ? `<span class="read-badge">既読</span>` : ""}
                    <span>${escapeHtml(item.source || "")}</span>
                    <span>•</span>
                    <span>${escapeHtml(formatRelativeTime(item))}</span>
                  </div>
                  <h3 class="text-news-title">${escapeHtml(item.title)}</h3>
                  <p class="text-news-summary">${escapeHtml(item.summary)}</p>
                </div>
                <button type="button" class="bookmark-btn ${isSaved ? "active" : ""}" data-bookmark-url="${escapeHtml(item.url || "")}" title="${isSaved ? "保存を解除" : "あとで読むに保存"}" aria-label="ブックマーク切替">${isSaved ? "★" : "☆"}</button>
              </article>
            `;
          })
          .join("");
      } else {
        elTextFeedWrap.hidden = true;
        elNewsTextList.innerHTML = "";
      }
    }
  }

  function fallbackExecCopy(text) {
    try {
      if (typeof document === "undefined" || !document.body || typeof document.createElement !== "function") {
        return false;
      }
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select?.();
      const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : true;
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch (_e) {
      return false;
    }
  }

  function copyTextToClipboard(text, onDone) {
    if (!text) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(text)
        .then(onDone)
        .catch(() => {
          if (fallbackExecCopy(text)) onDone();
        });
      return;
    }
    fallbackExecCopy(text);
    onDone();
  }

  function syncBodyScrollLock() {
    const anyModalOpen = Boolean(
      (elModal && !elModal.hidden) || (elSettingsModal && !elSettingsModal.hidden)
    );
    document.body.style.overflow = anyModalOpen ? "hidden" : "";
  }

  function openArticleModal(idx, urlFallback = "") {
    const items = Array.isArray(state.data.items) ? state.data.items : [];
    let item = Number.isInteger(idx) && idx >= 0 ? items[idx] : null;
    if (!item && urlFallback) {
      item = findArticleByUrl(urlFallback);
    }
    if (!item) return;

    state.currentModalItem = item;
    if (item.url) {
      markArticleRead(item.url);
    }

    const meta = getCategoryMeta(item.category);
    const img = getSafeImageUrl(item);
    const fb = getFallbackImage(item);
    const isSaved = isBookmarked(item.url);
    const pointsHtml = (Array.isArray(item.points) ? item.points : [])
      .map((pt) => `<li>${escapeHtml(pt)}</li>`)
      .join("");
    const tagsHtml = (Array.isArray(item.tags) ? item.tags : [])
      .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
      .join("");
    const safeUrl = isSafeHttpUrl(item.url) ? item.url.trim() : "";
    const lineShareUrl = safeUrl
      ? `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(safeUrl)}`
      : "";

    elModalContent.innerHTML = `
      <img class="modal-hero-img" src="${escapeHtml(img)}" data-fallback-src="${escapeHtml(fb)}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer" />
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

        <div style="display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>

        <div class="modal-actions">
          <div class="modal-share-bar">
            ${
              safeUrl
                ? `<button type="button" class="modal-action-btn ${isSaved ? "active" : ""}" id="btn-modal-bookmark" data-bookmark-url="${escapeHtml(safeUrl)}">${isSaved ? "★ 保存済み" : "☆ あとで読む"}</button>
                   <button type="button" class="modal-action-btn" id="btn-modal-copy" data-share-url="${escapeHtml(safeUrl)}">🔗 URLコピー</button>
                   <button type="button" class="modal-action-btn" id="btn-modal-share" data-share-url="${escapeHtml(safeUrl)}" data-share-title="${escapeHtml(item.title)}">📤 シェア</button>
                   <a class="modal-action-btn modal-line-btn" href="${escapeHtml(lineShareUrl)}" target="_blank" rel="noopener noreferrer">💬 LINEで送る</a>`
                : ""
            }
          </div>
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
    syncBodyScrollLock();
  }

  function closeModal() {
    elModal.hidden = true;
    state.currentModalItem = null;
    syncBodyScrollLock();
  }

  function setQuery(q) {
    state.query = q;
    elSearchInput.value = q;
    elSearchClear.hidden = !q;
    renderTrending();
    renderFeed();
  }

  const elMainContainer = document.querySelector(".main-container");

  function playSwipeAnimation(swipeDir) {
    if (!elMainContainer || !swipeDir) return;
    elMainContainer.classList.remove("swipe-in-right", "swipe-in-left");
    void elMainContainer.offsetWidth; // reflow
    elMainContainer.classList.add(swipeDir > 0 ? "swipe-in-right" : "swipe-in-left");
  }

  function syncCategoryTabsUI(cat, useInstantScroll = false) {
    let activeTabEl = null;
    navTabs.forEach((tab) => {
      const isMatch = tab.getAttribute("data-category") === cat;
      tab.classList.toggle("active", isMatch);
      if (isMatch) activeTabEl = tab;
    });
    if (elBtnWeatherShortcut) {
      const isWeather = cat === "weather";
      elBtnWeatherShortcut.classList.toggle("active", isWeather);
      elBtnWeatherShortcut.setAttribute("aria-pressed", String(isWeather));
    }
    if (activeTabEl && typeof activeTabEl.scrollIntoView === "function") {
      activeTabEl.scrollIntoView({
        behavior: useInstantScroll ? "auto" : "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }

  function setCategory(cat, swipeDir = 0, shouldScrollTop = true, resetQuery = false) {
    const targetCat = VALID_CATEGORIES.has(cat) ? cat : "all";
    if (state.catPrefs.hidden.includes(targetCat)) {
      state.catPrefs.hidden = state.catPrefs.hidden.filter((c) => c !== targetCat);
      safeStorageSet(localStorage, CAT_PREFS_STORAGE_KEY, JSON.stringify(state.catPrefs));
      applyCategoryPreferences();
    }
    state.category = targetCat;
    saveCategory(targetCat);
    if ((targetCat === "weather" || resetQuery) && state.query) {
      state.query = "";
      elSearchInput.value = "";
      elSearchClear.hidden = true;
      renderTrending();
    } else if (resetQuery) {
      elSearchInput.value = "";
      elSearchClear.hidden = true;
    }
    syncCategoryTabsUI(targetCat, false);
    renderFeed();
    playSwipeAnimation(swipeDir);
    if (shouldScrollTop && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
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

  function readCachedWeatherEntry() {
    const parsed = loadJsonFromStorage(WEATHER_CACHE_KEY, null);
    if (!parsed) return null;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return { updatedAt: "", cities: parsed };
    }
    if (Array.isArray(parsed.cities) && parsed.cities.length > 0) {
      return { updatedAt: parsed.updatedAt || "", cities: parsed.cities };
    }
    return null;
  }

  function saveCachedWeatherCities(cities, updatedAt = "") {
    if (!Array.isArray(cities) || cities.length === 0) return;
    safeStorageSet(
      localStorage,
      WEATHER_CACHE_KEY,
      JSON.stringify({
        updatedAt: updatedAt || formatNowJst().updatedAt,
        cities,
      })
    );
  }

  function getBestAvailableWeatherCities(candidate) {
    if (candidate && Array.isArray(candidate.weatherCities) && candidate.weatherCities.length > 0) {
      return candidate.weatherCities.map((c) => ({ ...c }));
    }
    const bundledMs = parseUpdatedAtMs(INITIAL_BUNDLED_UPDATED_AT);
    const cachedEntry = readCachedWeatherEntry();
    const cachedMs = parseUpdatedAtMs(cachedEntry?.updatedAt);
    const currentCities = Array.isArray(state.data?.weatherCities) && state.data.weatherCities.length > 0
      ? state.data.weatherCities
      : null;

    if (currentCities && parseUpdatedAtMs(state.data?.updatedAt) >= cachedMs) {
      return currentCities.map((c) => ({ ...c }));
    }
    if (cachedEntry && cachedEntry.cities.length > 0 && cachedMs >= bundledMs) {
      return cachedEntry.cities.map((c) => ({ ...c }));
    }
    if (INITIAL_BUNDLED_WEATHER_CITIES.length > 0) {
      return INITIAL_BUNDLED_WEATHER_CITIES.map((c) => ({ ...c }));
    }
    if (cachedEntry && cachedEntry.cities.length > 0) {
      return cachedEntry.cities.map((c) => ({ ...c }));
    }
    return DEFAULT_WEATHER_CITIES.map((c) => ({ ...c }));
  }

  function computeDataSignature(data) {
    if (!data || !Array.isArray(data.items)) return "";
    const firstTitle = data.items[0]?.title || "";
    const firstImg = data.items[0]?.image || "";
    const weatherLen = Array.isArray(data.weatherCities) ? data.weatherCities.length : 0;
    return `${data.updatedAt || ""}|${data.items.length}|${firstTitle}|${firstImg}|${weatherLen}`;
  }

  function applyNewsDataIfNewer(candidate, forceApply = false) {
    if (!candidate || !Array.isArray(candidate.items) || candidate.items.length === 0) return false;
    const cleanItems = normalizeNewsItems(candidate.items);
    if (cleanItems.length === 0) return false;

    const currentMs = parseUpdatedAtMs(state.data?.updatedAt);
    const candidateMs = parseUpdatedAtMs(candidate.updatedAt);
    // 現在表示中のデータより古いデータには絶対に戻さない
    if (currentMs > 0 && candidateMs > 0 && candidateMs < currentMs) {
      return false;
    }
    // 同時刻で24時間以内の件数が減る場合も上書きしない
    const currentCleanLen = normalizeNewsItems(state.data?.items).length;
    if (currentMs > 0 && candidateMs === currentMs && cleanItems.length < currentCleanLen) {
      return false;
    }

    const bestWeather = getBestAvailableWeatherCities(candidate);
    const normalizedCandidate = {
      ...candidate,
      items: cleanItems,
      weatherCities: bestWeather,
    };
    if (Array.isArray(candidate.weatherCities) && candidate.weatherCities.length > 0) {
      saveCachedWeatherCities(candidate.weatherCities, candidate.updatedAt || "");
    }

    const sig = computeDataSignature(normalizedCandidate);
    if (forceApply || sig !== state.lastDataSignature) {
      window.NEWS_DATA = normalizedCandidate;
      state.data = normalizedCandidate;
      state.lastDataSignature = sig;
      safeStorageSet(localStorage, "trend-news-live-cache", JSON.stringify(normalizedCandidate));
      renderAll();
      return true;
    }
    return false;
  }

  function restoreCachedNewsOnStartup() {
    if (INITIAL_BUNDLED_WEATHER_CITIES.length > 0) {
      const existingWeatherCache = readCachedWeatherEntry();
      if (
        !existingWeatherCache ||
        parseUpdatedAtMs(INITIAL_BUNDLED_UPDATED_AT) >= parseUpdatedAtMs(existingWeatherCache.updatedAt)
      ) {
        saveCachedWeatherCities(INITIAL_BUNDLED_WEATHER_CITIES, INITIAL_BUNDLED_UPDATED_AT);
      }
    }
    const cached = loadJsonFromStorage("trend-news-live-cache", null);
    if (cached) {
      applyNewsDataIfNewer(cached, false);
    }
  }

  async function fetchGithubNewsData() {
    const ts = Date.now();
    const fetchFromApi = async () => {
      const apiUrl = `https://api.github.com/repos/kazunews-app/morning-news-slides/contents/data/news.js?ref=main&_=${ts}`;
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
      fetchFromUrl(`https://raw.githubusercontent.com/kazunews-app/morning-news-slides/main/data/news.js?t=${ts}`),
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

  function resolveSafeCandidateImg(rawUrl, baseUrl) {
    if (typeof rawUrl !== "string") return "";
    let cand = rawUrl.trim().replace(/&amp;/g, "&");
    if (!cand || cand.startsWith("data:")) return "";
    if (cand.startsWith("//")) cand = `https:${cand}`;
    if (!cand.startsWith("http://") && !cand.startsWith("https://") && baseUrl) {
      try {
        cand = new URL(cand, baseUrl).href;
      } catch (_e) {
        return "";
      }
    }
    return isGenericOrSampleImageUrl(cand) ? "" : cand;
  }

  function extractImgFromHtmlSnippet(html, baseUrl) {
    if (typeof html !== "string" || !html) return "";
    const matches = html.matchAll(/<img[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/gi);
    for (const m of matches) {
      const safe = resolveSafeCandidateImg(m[1], baseUrl);
      if (safe) return safe;
    }
    return "";
  }

  function parseFlexibleDateTs(rawDate) {
    if (typeof rawDate !== "string") return 0;
    const trimmed = rawDate.trim();
    if (!trimmed) return 0;
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const ms = Date.parse(trimmed.replace(/\s+/, "T") + "Z");
      return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  }

  function findXmlChildText(parent, localNames) {
    if (!parent || !parent.children) return "";
    const nameSet = new Set(localNames);
    for (const child of parent.children) {
      const ln = (child.localName || child.nodeName.split(":").pop() || "").toLowerCase();
      if (nameSet.has(ln) && child.textContent) {
        return child.textContent.trim();
      }
    }
    return "";
  }

  function findXmlChildAttr(parent, localNames, attrName) {
    if (!parent || !parent.children) return "";
    const nameSet = new Set(localNames);
    for (const child of parent.children) {
      const ln = (child.localName || child.nodeName.split(":").pop() || "").toLowerCase();
      if (nameSet.has(ln)) {
        const val = child.getAttribute?.(attrName) || "";
        if (val) return val.trim();
      }
    }
    return "";
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
      const publishedTs = parseFlexibleDateTs(it.pubDate || "");
      const thumbCandidates = [
        it.thumbnail,
        it.enclosure?.link,
        it.enclosure?.thumbnail,
        extractImgFromHtmlSnippet(it.content || it.description || "", link),
      ];
      let rawThumb = "";
      for (const cand of thumbCandidates) {
        const safe = resolveSafeCandidateImg(cand, link);
        if (safe) {
          rawThumb = safe;
          break;
        }
      }
      return {
        category,
        title,
        url: link,
        source: sourceFallback,
        publishedTs,
        publishedAt: publishedTs > 0 ? formatJstFromTs(publishedTs) : "",
        rawThumb,
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
      const title = findXmlChildText(node, ["title"]);
      let link = "";
      if (isAtom) {
        link =
          node.querySelector('link[rel="alternate"]')?.getAttribute("href") ||
          findXmlChildAttr(node, ["link"], "href");
      } else {
        link = findXmlChildText(node, ["link"]);
      }
      const pubRaw = findXmlChildText(node, ["pubdate", "published", "updated", "date"]);
      const publishedTs = parseFlexibleDateTs(pubRaw);
      const encodedHtml = findXmlChildText(node, ["encoded"]);
      const desc = findXmlChildText(node, ["description", "summary", "content"]);
      const enclosureUrl = findXmlChildAttr(node, ["enclosure"], "url");
      const mediaContentUrl = findXmlChildAttr(node, ["content"], "url");
      const mediaThumbUrl = findXmlChildAttr(node, ["thumbnail"], "url");
      const imageNodeText = findXmlChildText(node, ["image"]);
      const hatenaImg = findXmlChildText(node, ["imageurl"]);
      const htmlImg = extractImgFromHtmlSnippet(`${encodedHtml}\n${desc}`, link);
      let rawThumb = "";
      for (const cand of [enclosureUrl, mediaContentUrl, mediaThumbUrl, imageNodeText, htmlImg, hatenaImg]) {
        const safe = resolveSafeCandidateImg(cand, link);
        if (safe) {
          rawThumb = safe;
          break;
        }
      }
      return {
        category,
        title,
        url: link,
        source: sourceFallback,
        publishedTs,
        publishedAt: publishedTs > 0 ? formatJstFromTs(publishedTs) : "",
        rawThumb,
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

  function extractImagesFromLdJsonText(rawJson) {
    const out = [];
    try {
      const parsed = JSON.parse(rawJson);
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length > 0) {
        const cur = stack.shift();
        if (!cur || typeof cur !== "object") continue;
        if (Array.isArray(cur)) {
          stack.push(...cur);
          continue;
        }
        const imgVal = cur.image || cur.thumbnailUrl;
        if (typeof imgVal === "string") {
          out.push(imgVal);
        } else if (Array.isArray(imgVal)) {
          imgVal.forEach((v) => {
            if (typeof v === "string") out.push(v);
            else if (v && typeof v.url === "string") out.push(v.url);
          });
        } else if (imgVal && typeof imgVal === "object" && typeof imgVal.url === "string") {
          out.push(imgVal.url);
        }
        Object.values(cur).forEach((v) => {
          if (v && typeof v === "object") stack.push(v);
        });
      }
    } catch (_e) {}
    return out;
  }

  async function fetchLiveOgForUrl(url) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const res = await fetchWithTimeout(proxyUrl, {}, 2600);
      if (!res.ok) return {};
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      let foundImg = "";
      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
        'meta[property="twitter:image"]',
      ];
      for (const sel of metaSelectors) {
        const val = doc.querySelector(sel)?.getAttribute("content") || "";
        const safe = resolveSafeCandidateImg(val, url);
        if (safe) {
          foundImg = safe;
          break;
        }
      }
      if (!foundImg) {
        const linkSrc = doc.querySelector('link[rel="image_src"]')?.getAttribute("href") || "";
        foundImg = resolveSafeCandidateImg(linkSrc, url);
      }
      if (!foundImg) {
        for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
          for (const rawImg of extractImagesFromLdJsonText(script.textContent || "")) {
            const safe = resolveSafeCandidateImg(rawImg, url);
            if (safe) {
              foundImg = safe;
              break;
            }
          }
          if (foundImg) break;
        }
      }
      if (!foundImg) {
        const imgEls = [
          ...doc.querySelectorAll("article img, main img, .article-body img, .entry-content img"),
          ...doc.querySelectorAll("img"),
        ];
        const badMarkerRe = /(icon|logo|avatar|badge|banner|button|btn|spacer|emoji)/i;
        for (const imgEl of imgEls) {
          if (imgEl.closest("header, footer, nav, aside")) continue;
          const attrMarker = `${imgEl.className || ""} ${imgEl.id || ""} ${imgEl.getAttribute("alt") || ""}`;
          if (badMarkerRe.test(attrMarker)) continue;
          const w = parseInt(imgEl.getAttribute("width") || "", 10);
          const h = parseInt(imgEl.getAttribute("height") || "", 10);
          if ((Number.isFinite(w) && w < 64) || (Number.isFinite(h) && h < 64)) continue;
          const cand =
            imgEl.getAttribute("data-src") ||
            imgEl.getAttribute("data-original") ||
            imgEl.getAttribute("src") ||
            "";
          const safe = resolveSafeCandidateImg(cand, url);
          if (safe) {
            foundImg = safe;
            break;
          }
        }
      }
      if (!foundImg) {
        const yMatch = html.match(/https:\/\/newsatcl-pctr\.c\.yimg\.jp\/[^\s"'<>]+/);
        if (yMatch) {
          foundImg = resolveSafeCandidateImg(yMatch[0], url);
        }
      }

      const ogDesc =
        doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
        doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
        "";
      return {
        image: foundImg,
        summary: ogDesc ? ogDesc.trim() : "",
      };
    } catch (_e) {
      return {};
    }
  }

  function enrichNewImagesInBackground(newTargets) {
    if (!newTargets || newTargets.length === 0) return;
    Promise.allSettled(
      newTargets.slice(0, 30).map(async (target) => {
        const og = await fetchLiveOgForUrl(target.url);
        let changed = false;
        if (og.image && !isGenericOrSampleImageUrl(og.image)) {
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
        safeStorageSet(localStorage, "trend-news-live-cache", JSON.stringify(state.data));
        if (state.category !== "weather") {
          renderFeed();
        }
      }
    });
  }

  function interleaveArrays(arrays) {
    const out = [];
    const maxLen = arrays.reduce((m, a) => Math.max(m, a.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const arr of arrays) {
        if (i < arr.length) out.push(arr[i]);
      }
    }
    return out;
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
      const nowSec = Math.floor(Date.now() / 1000);
      const list = [];
      for (const raw of rawCandidates) {
        if (!raw.title || !raw.url) continue;
        if (!isArticleWithin24Hours(raw, nowSec)) continue;
        if (seen.has(raw.url) || seen.has(raw.title)) continue;
        seen.add(raw.url);
        seen.add(raw.title);

        const cached = existingByUrl.get(raw.url) || existingByTitle.get(raw.title);
        if (cached) {
          const safeImg = getSafeImageUrl(cached);
          const itemObj = { ...cached, category: catKey, image: safeImg };
          list.push(itemObj);
          if (isGenericOrSampleImageUrl(cached.image) && bgOgTargets.length < 30) {
            bgOgTargets.push({ url: raw.url, item: itemObj });
          }
        } else {
          const hasValidThumb = !isGenericOrSampleImageUrl(raw.rawThumb);
          const img = hasValidThumb
            ? raw.rawThumb
            : getRelatedWebImageUrl({ title: raw.title, category: catKey });
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
          if (!hasValidThumb && bgOgTargets.length < 30) {
            bgOgTargets.push({ url: raw.url, item: itemObj });
          }
        }
        if (list.length >= 30) break;
      }

      for (const oldIt of existingCatItems) {
        if (list.length >= 30) break;
        if (!isArticleWithin24Hours(oldIt, nowSec)) continue;
        if (!seen.has(oldIt.url) && !seen.has(oldIt.title)) {
          seen.add(oldIt.url);
          seen.add(oldIt.title);
          const safeImg = getSafeImageUrl(oldIt);
          list.push(oldIt.image === safeImg ? oldIt : { ...oldIt, image: safeImg });
        }
      }
      return list;
    }

    const oldItems = baseData?.items || [];
    const domList = buildCategoryList([...domYahoo, ...domHatena], oldItems.filter((i) => i.category === "domestic"), "domestic");
    const techList = buildCategoryList([...techYahoo, ...techHatena], oldItems.filter((i) => i.category === "tech"), "tech");
    const bizList = buildCategoryList([...bizYahoo, ...bizHatena], oldItems.filter((i) => i.category === "business"), "business");
    const entList = buildCategoryList([...entYahoo, ...entHatena], oldItems.filter((i) => i.category === "entertainment"), "entertainment");

    const subInterleaved = interleaveArrays([subAuto, subComic, subVtuber, subGame]);
    const subList = buildCategoryList(subInterleaved, oldItems.filter((i) => i.category === "subculture"), "subculture");

    const interleaved = interleaveArrays([domList, techList, bizList, entList, subList]);
    if (interleaved.length === 0) return null;

    const nowJst = formatNowJst();
    const keywords =
      Array.isArray(baseData?.keywords) && baseData.keywords.length > 0
        ? baseData.keywords
        : interleaved.slice(0, 6).map((it) => (it.title.length > 13 ? it.title.slice(0, 13) + "…" : it.title));

    return {
      payload: {
        date: nowJst.date,
        updatedAt: nowJst.updatedAt,
        title: "TREND NEWS",
        keywords,
        weatherCities: getBestAvailableWeatherCities(baseData),
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

      // Step 2: GitHub側データが5分以上古い（または取得不可）場合のみ、ブラウザから直接RSSを並列取得
      const ghAgeMs = ghData ? Date.now() - parseUpdatedAtMs(ghData.updatedAt) : Infinity;
      const currentAgeMs = Date.now() - parseUpdatedAtMs(state.data?.updatedAt);
      if ((!ghData || ghAgeMs >= 5 * 60 * 1000) && (isManual || currentAgeMs >= 5 * 60 * 1000)) {
        const liveRes = await fetchLiveBrowserNews(state.data);
        if (liveRes && liveRes.payload) {
          applyNewsDataIfNewer(liveRes.payload, true);
          // OGP画像取得は描画をブロックせず裏で並列差し替え
          enrichNewImagesInBackground(liveRes.bgOgTargets);
        } else if (isManual && !ghData) {
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

  // Weather Dedicated Section (現在地 + 日本地図の主要都市)
  const elWeatherCurrentWrap = document.getElementById("weather-current-wrap");
  const elWeatherMapPins = document.getElementById("weather-map-pins");
  const elWeatherDetailPanel = document.getElementById("weather-detail-panel");
  const elWeatherUpdatedLabel = document.getElementById("weather-updated-label");

  const MAJOR_JP_CITIES = [
    { name: "札幌", region: "北海道", lat: 43.0618, lon: 141.3545, x: 63, y: 15, jmaOffice: "016000" },
    { name: "仙台", region: "東北", lat: 38.2682, lon: 140.8694, x: 78, y: 45, jmaOffice: "040000" },
    { name: "新潟", region: "北陸", lat: 37.9161, lon: 139.0364, x: 52, y: 42, jmaOffice: "150000" },
    { name: "金沢", region: "北陸", lat: 36.5613, lon: 136.6562, x: 41, y: 51, jmaOffice: "170000" },
    { name: "東京", region: "関東", lat: 35.6812, lon: 139.7671, x: 76, y: 65, jmaOffice: "130000" },
    { name: "名古屋", region: "東海", lat: 35.1815, lon: 136.9066, x: 55, y: 76, jmaOffice: "230000" },
    { name: "大阪", region: "近畿", lat: 34.6937, lon: 135.5023, x: 41, y: 79, jmaOffice: "270000" },
    { name: "広島", region: "中国", lat: 34.3853, lon: 132.4553, x: 24, y: 63, jmaOffice: "340000" },
    { name: "高知", region: "四国", lat: 33.5597, lon: 133.5311, x: 27, y: 86, jmaOffice: "390000" },
    { name: "福岡", region: "九州", lat: 33.5902, lon: 130.4017, x: 11, y: 70, jmaOffice: "400000" },
    { name: "那覇", region: "沖縄", lat: 26.2124, lon: 127.6809, x: 28, y: 17, jmaOffice: "471000" },
  ];

  const JP_CITY_COORDS = {
    札幌: [43.0618, 141.3545], 旭川: [43.7706, 142.365], 函館: [41.7687, 140.7288],
    青森: [40.8221, 140.7474], 盛岡: [39.702, 141.1545], 仙台: [38.2682, 140.8694],
    秋田: [39.7186, 140.1024], 山形: [38.2554, 140.3396], 福島: [37.7608, 140.4747], 郡山: [37.4005, 140.3597],
    水戸: [36.3659, 140.4712], つくば: [36.0835, 140.0764], 宇都宮: [36.5551, 139.8828],
    前橋: [36.3895, 139.0634], 高崎: [36.3219, 139.0033],
    さいたま: [35.8617, 139.6455], 大宮: [35.9063, 139.624], 川口: [35.8076, 139.724],
    千葉: [35.6074, 140.1065], 船橋: [35.6947, 139.9826], 柏: [35.8676, 139.9757],
    東京: [35.6812, 139.7671], 新宿: [35.6938, 139.7034], 渋谷: [35.658, 139.7016],
    品川: [35.6285, 139.7388], 池袋: [35.7295, 139.7109], 八王子: [35.6664, 139.316],
    横浜: [35.4437, 139.638], 川崎: [35.5308, 139.7029], 相模原: [35.5713, 139.3732],
    新潟: [37.9161, 139.0364], 富山: [36.6953, 137.2113], 金沢: [36.5613, 136.6562], 福井: [36.0641, 136.2195],
    甲府: [35.6621, 138.5683], 長野: [36.6486, 138.1942], 岐阜: [35.4233, 136.7607],
    静岡: [34.9756, 138.3828], 浜松: [34.7108, 137.7261], 名古屋: [35.1815, 136.9066], 豊田: [35.0824, 137.1562],
    津: [34.7186, 136.5057], 大津: [35.0179, 135.8546], 京都: [35.0116, 135.7681],
    大阪: [34.6937, 135.5023], 堺: [34.5733, 135.483], 神戸: [34.6901, 135.1955], 姫路: [34.8151, 134.6853],
    奈良: [34.6851, 135.8048], 和歌山: [34.2305, 135.1708],
    鳥取: [35.5011, 134.2351], 松江: [35.4681, 133.0484], 岡山: [34.6551, 133.9195],
    広島: [34.3853, 132.4553], 福山: [34.4859, 133.3623], 山口: [34.1785, 131.4737],
    徳島: [34.0703, 134.5548], 高松: [34.3428, 134.0466], 松山: [33.8392, 132.7657], 高知: [33.5597, 133.5311],
    福岡: [33.5902, 130.4017], 北九州: [33.8834, 130.8752], 久留米: [33.3193, 130.5084],
    佐賀: [33.2635, 130.3009], 長崎: [32.7503, 129.8777], 熊本: [32.8031, 130.7079],
    大分: [33.2382, 131.6126], 宮崎: [31.9077, 131.4202], 鹿児島: [31.5966, 130.5571], 那覇: [26.2124, 127.6809],
  };

  function findNearestMajorCity(lat, lon) {
    let best = MAJOR_JP_CITIES[4]; // 東京デフォルト
    let bestDist = Infinity;
    for (const city of MAJOR_JP_CITIES) {
      const dLat = city.lat - lat;
      const dLon = (city.lon - lon) * 0.82;
      const dist = dLat * dLat + dLon * dLon;
      if (dist < bestDist) {
        bestDist = dist;
        best = city;
      }
    }
    return best;
  }

  function jmaCodeToWmo(jmaCode, weatherText = "") {
    const code = String(jmaCode || "").trim();
    const text = String(weatherText || "");
    if (text.includes("雷")) return 95;
    if (text.startsWith("雪") || text.startsWith("みぞれ") || text.includes("吹雪")) return 71;
    if (text.startsWith("雨")) return 61;
    if (code.startsWith("4")) return 71;
    if (code.startsWith("3")) return 61;
    if (code.startsWith("2")) return text.includes("雨") ? 80 : text.includes("雪") ? 71 : 3;
    if (code.startsWith("1")) {
      if (code === "100") return 0;
      if (text.includes("雨")) return 80;
      if (text.includes("雪")) return 71;
      return 1;
    }
    return 1;
  }

  const weatherState = {
    lastFetchAt: 0,
    isFetching: false,
    currentLoc: null, // { lat, lon, locName, isFallback? }
    cityResults: [],
    selectedCityName: null,
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
      const saved = JSON.parse(safeStorageGet(localStorage, "trend-news-geo") || "null");
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
    const raw = cityName.trim();
    if (!raw) return null;
    const stripped = raw.replace(/\s+/g, "").replace(/[都道府県市区町村]$/, "");
    const localMatchKey =
      (JP_CITY_COORDS[raw] && raw) ||
      (JP_CITY_COORDS[stripped] && stripped) ||
      Object.keys(JP_CITY_COORDS).find((k) => stripped.includes(k) || k.includes(stripped));
    if (localMatchKey) {
      const [lat, lon] = JP_CITY_COORDS[localMatchKey];
      return { lat, lon, locName: raw };
    }
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(raw)}&count=1&language=ja&format=json`;
      const res = await fetchWithTimeout(url, {}, 5000);
      if (!res.ok) return null;
      const data = await res.json();
      const first = data.results?.[0];
      if (!first) return null;
      return {
        lat: Number(first.latitude.toFixed(4)),
        lon: Number(first.longitude.toFixed(4)),
        locName: first.name || raw,
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
      safeStorageSet(localStorage, "trend-news-geo", JSON.stringify(found));
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
        safeStorageSet(localStorage, "trend-news-geo", JSON.stringify(geo));
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

  const DOW_SHORT_JP = ["日", "月", "火", "水", "木", "金", "土"];

  function buildDefaultHourlyAndDaily(base) {
    const temp = Math.round(Number(base?.temp ?? 16));
    const maxTemp = Math.round(Number(base?.maxTemp ?? temp + 2));
    const minTemp = Math.round(Number(base?.minTemp ?? temp - 3));
    const code = Math.round(Number(base?.code ?? 1));
    const pop = Math.round(Number(base?.pop ?? 10));

    const now = new Date();
    const jstMs = now.getTime() + (now.getTimezoneOffset() + 540) * 60000;
    const jst = new Date(jstMs);
    const startHour = Math.floor(jst.getHours() / 3) * 3;

    const hourly = [];
    for (let i = 0; i < 8; i++) {
      const h = (startHour + i * 3) % 24;
      const phase = Math.min(1, Math.abs(h - 14) / 12);
      const estTemp = Math.round(maxTemp - (maxTemp - minTemp) * phase);
      hourly.push({
        time: `${String(h).padStart(2, "0")}:00`,
        code,
        temp: estTemp,
        pop,
      });
    }

    const daily = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(jstMs + d * 86400000);
      const offset = d > 0 ? (d % 3) - 1 : 0;
      daily.push({
        date: `${dt.getMonth() + 1}/${dt.getDate()}`,
        dow: d === 0 ? "今日" : d === 1 ? "明日" : DOW_SHORT_JP[dt.getDay()],
        code,
        maxTemp: maxTemp + offset,
        minTemp: minTemp + offset,
        pop,
      });
    }
    return { hourly, daily };
  }

  function ensureWeatherForecasts(w) {
    if (!w) return w;
    const hasHourly = Array.isArray(w.hourly) && w.hourly.length >= 4;
    const hasDaily = Array.isArray(w.daily) && w.daily.length >= 5;
    if (hasHourly && hasDaily) return w;
    const fb = buildDefaultHourlyAndDaily(w);
    return {
      ...w,
      hourly: hasHourly ? w.hourly : fb.hourly,
      daily: hasDaily ? w.daily : fb.daily,
    };
  }

  function parseWeatherItem(entry) {
    const temp = Math.round(entry?.current?.temperature_2m ?? 0);
    const code = Math.round(Number(entry?.current?.weather_code ?? 0));
    const wind = Math.round(entry?.current?.wind_speed_10m ?? 0);
    const meta = getWeatherMeta(code);
    const maxTemp = Math.round(entry?.daily?.temperature_2m_max?.[0] ?? temp);
    const minTemp = Math.round(entry?.daily?.temperature_2m_min?.[0] ?? temp);
    const pop = entry?.daily?.precipitation_probability_max?.[0] ?? 0;

    const hourly = [];
    const hTimes = entry?.hourly?.time || [];
    const hTemps = entry?.hourly?.temperature_2m || [];
    const hCodes = entry?.hourly?.weather_code || [];
    const hPops = entry?.hourly?.precipitation_probability || [];
    if (hTimes.length > 0) {
      const nowJstIso = formatNowJst().updatedAt.replace(" ", "T").slice(0, 13) + ":00";
      let startIdx = hTimes.findIndex((t) => String(t) >= nowJstIso);
      if (startIdx < 0) startIdx = 0;
      for (let step = 0; step < 8; step++) {
        const pos = startIdx + step * 3;
        if (pos >= hTimes.length) break;
        const timeStr = String(hTimes[pos]).split("T").pop()?.slice(0, 5) || "00:00";
        hourly.push({
          time: timeStr,
          code: Math.round(Number(hCodes[pos] ?? code)),
          temp: Math.round(Number(hTemps[pos] ?? temp)),
          pop: Math.round(Number(hPops[pos] ?? pop)),
        });
      }
    }

    const daily = [];
    const dTimes = entry?.daily?.time || [];
    const dCodes = entry?.daily?.weather_code || [];
    const dMaxs = entry?.daily?.temperature_2m_max || [];
    const dMins = entry?.daily?.temperature_2m_min || [];
    const dPops = entry?.daily?.precipitation_probability_max || [];
    dTimes.slice(0, 7).forEach((dStr, idx) => {
      const dt = new Date(`${dStr}T00:00:00+09:00`);
      const m = Number.isFinite(dt.getMonth()) ? dt.getMonth() + 1 : idx + 1;
      const d = Number.isFinite(dt.getDate()) ? dt.getDate() : idx + 1;
      const dow = Number.isFinite(dt.getDay()) ? DOW_SHORT_JP[dt.getDay()] : "";
      daily.push({
        date: `${m}/${d}`,
        dow: idx === 0 ? "今日" : idx === 1 ? "明日" : dow,
        code: Math.round(Number(dCodes[idx] ?? code)),
        maxTemp: Math.round(Number(dMaxs[idx] ?? maxTemp)),
        minTemp: Math.round(Number(dMins[idx] ?? minTemp)),
        pop: Math.round(Number(dPops[idx] ?? pop)),
      });
    });

    return ensureWeatherForecasts({ temp, wind, code, meta, maxTemp, minTemp, pop, hourly, daily });
  }

  function parseJmaForecastEntry(jmaJson, fallbackEntry) {
    const rep = Array.isArray(jmaJson) ? jmaJson[0] : null;
    const weekly = Array.isArray(jmaJson) ? jmaJson[1] : null;
    const area0 = rep?.timeSeries?.[0]?.areas?.[0] || {};
    const jmaCode = String(area0.weatherCodes?.[0] || "");
    const wText = String(area0.weathers?.[0] || "");
    const code = jmaCodeToWmo(jmaCode, wText);

    const popsRaw = (rep?.timeSeries?.[1]?.areas?.[0]?.pops || [])
      .map((p) => Number(p))
      .filter((n) => Number.isFinite(n));
    const pop = popsRaw.length > 0 ? Math.max(...popsRaw.slice(0, 3)) : (fallbackEntry?.pop ?? 10);

    const tempsRaw = (rep?.timeSeries?.[2]?.areas?.[0]?.temps || [])
      .map((t) => Number(t))
      .filter((n) => Number.isFinite(n));
    const wkArea0 = weekly?.timeSeries?.[0]?.areas?.[0] || {};
    const wkArea = weekly?.timeSeries?.[1]?.areas?.[0] || {};
    const wkMins = (wkArea.tempsMin || []).map(Number).filter(Number.isFinite);
    const wkMaxs = (wkArea.tempsMax || []).map(Number).filter(Number.isFinite);

    let maxTemp = fallbackEntry?.maxTemp ?? 18;
    let minTemp = fallbackEntry?.minTemp ?? 10;
    if (tempsRaw.length >= 4) {
      maxTemp = Math.round(tempsRaw[0]);
      minTemp = Math.round(Math.min(tempsRaw[1], tempsRaw[2]));
    } else if (tempsRaw.length === 3) {
      maxTemp = Math.round(tempsRaw[0]);
      minTemp = Math.round(tempsRaw[1]);
    } else if (tempsRaw.length >= 1) {
      minTemp = Math.round(Math.min(...tempsRaw));
      maxTemp = Math.round(Math.max(...tempsRaw));
      if (wkMaxs.length > 0) maxTemp = Math.max(maxTemp, Math.round(wkMaxs[0]));
      if (wkMins.length > 0) minTemp = Math.min(minTemp, Math.round(wkMins[0]));
    } else if (wkMaxs.length > 0 && wkMins.length > 0) {
      maxTemp = Math.round(wkMaxs[0]);
      minTemp = Math.round(wkMins[0]);
    }
    const temp = tempsRaw.length >= 1 ? Math.round(tempsRaw[0]) : (fallbackEntry?.temp ?? Math.round((maxTemp + minTemp) / 2));

    const wkDates = weekly?.timeSeries?.[0]?.timeDefines || [];
    const wkCodes = wkArea0.weatherCodes || [];
    const wkPops = wkArea0.pops || [];
    const wkMaxRaw = wkArea.tempsMax || [];
    const wkMinRaw = wkArea.tempsMin || [];
    const daily = [];
    wkDates.slice(0, 7).forEach((dStr, idx) => {
      const dt = new Date(dStr);
      const m = Number.isFinite(dt.getMonth()) ? dt.getMonth() + 1 : idx + 1;
      const d = Number.isFinite(dt.getDate()) ? dt.getDate() : idx + 1;
      const dow = Number.isFinite(dt.getDay()) ? DOW_SHORT_JP[dt.getDay()] : "";
      const dCode = jmaCodeToWmo(wkCodes[idx] || jmaCode);
      const dPopNum = Number(wkPops[idx]);
      const dMaxNum = Number(wkMaxRaw[idx]);
      const dMinNum = Number(wkMinRaw[idx]);
      daily.push({
        date: `${m}/${d}`,
        dow: idx === 0 ? "今日" : idx === 1 ? "明日" : dow,
        code: dCode,
        maxTemp: Number.isFinite(dMaxNum) && String(wkMaxRaw[idx]).trim() ? Math.round(dMaxNum) : maxTemp,
        minTemp: Number.isFinite(dMinNum) && String(wkMinRaw[idx]).trim() ? Math.round(dMinNum) : minTemp,
        pop: Number.isFinite(dPopNum) && String(wkPops[idx]).trim() ? Math.round(dPopNum) : pop,
      });
    });

    return ensureWeatherForecasts({
      temp,
      wind: fallbackEntry?.wind ?? 4,
      code,
      meta: getWeatherMeta(code),
      maxTemp,
      minTemp,
      pop,
      hourly: fallbackEntry?.hourly,
      daily: daily.length >= 5 ? daily : fallbackEntry?.daily,
    });
  }

  async function fetchCityWeatherFromJma(city, fallbackEntry = null) {
    const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${city.jmaOffice}.json`;
    const res = await fetchWithTimeout(url, { cache: "no-store" }, 7000);
    if (!res.ok) throw new Error(`JMA HTTP ${res.status}`);
    const json = await res.json();
    return parseJmaForecastEntry(json, fallbackEntry);
  }

  function renderWeatherForecastBlocksHtml(w) {
    const safeW = ensureWeatherForecasts(w);
    const hourlyHtml = (safeW.hourly || [])
      .slice(0, 8)
      .map((h) => {
        const m = getWeatherMeta(h.code);
        return `
          <div class="weather-hour-item">
            <span class="weather-hour-time">${escapeHtml(h.time)}</span>
            <span class="weather-hour-icon">${m.icon}</span>
            <span class="weather-hour-temp">${h.temp}°</span>
            <span class="weather-hour-pop">☔${h.pop}%</span>
          </div>
        `;
      })
      .join("");

    const dailyHtml = (safeW.daily || [])
      .slice(0, 7)
      .map((d) => {
        const m = getWeatherMeta(d.code);
        return `
          <div class="weather-day-col">
            <span class="weather-day-label">${escapeHtml(d.dow)}</span>
            <span class="weather-day-date">${escapeHtml(d.date)}</span>
            <span class="weather-day-icon">${m.icon}</span>
            <span class="weather-day-temps">${d.maxTemp}°/${d.minTemp}°</span>
            <span class="weather-day-pop">☔${d.pop}%</span>
          </div>
        `;
      })
      .join("");

    return `
      <div class="weather-forecast-block">
        <div class="weather-forecast-title">🕒 3時間ごとの天気推移</div>
        <div class="weather-hourly-strip">${hourlyHtml}</div>
      </div>
      <div class="weather-forecast-block">
        <div class="weather-forecast-title">📅 週間天気予報（7日間）</div>
        <div class="weather-daily-list">${dailyHtml}</div>
      </div>
    `;
  }

  function renderCurrentWeatherCard(loc, w) {
    const safeW = ensureWeatherForecasts(w);
    if (safeW?.meta?.icon) syncHeaderWeatherIcon(safeW.meta.icon);
    if (!elWeatherCurrentWrap) return;
    elWeatherCurrentWrap.innerHTML = `
      <div class="weather-current-card">
        <div class="weather-current-top">
          <div class="weather-current-main">
            <div class="weather-current-icon">${safeW.meta.icon}</div>
            <div>
              <div class="weather-current-loc-badge">📍 現在地の天気</div>
              <div class="weather-current-city">${escapeHtml(loc.locName)}</div>
              <div class="weather-current-desc">${escapeHtml(safeW.meta.label)}・最高 ${safeW.maxTemp}°C / 最低 ${safeW.minTemp}°C</div>
            </div>
          </div>
          <div class="weather-current-stats">
            <div class="weather-current-temp">${safeW.temp}°C</div>
            <div class="weather-current-details">
              <span>☔ 降水確率: ${safeW.pop}%</span>
              <span>🍃 風速: ${safeW.wind} km/h</span>
            </div>
            <div class="weather-loc-actions">
              <button type="button" class="weather-action-btn" id="btn-weather-gps">📍 現在地を再取得</button>
              <button type="button" class="weather-action-btn" id="btn-weather-city">🏙️ 都市名を指定</button>
            </div>
          </div>
        </div>
        <div class="weather-current-forecasts">
          ${renderWeatherForecastBlocksHtml(safeW)}
        </div>
      </div>
    `;
    document.getElementById("btn-weather-gps")?.addEventListener("click", () => requestGeolocationAndRefresh(true));
    document.getElementById("btn-weather-city")?.addEventListener("click", () => promptManualCityWeather());
  }

  function renderCityDetailPanel(entry) {
    if (!elWeatherDetailPanel) return;
    if (!entry) {
      elWeatherDetailPanel.innerHTML = `
        <div class="weather-detail-placeholder">
          <p>👆 地図上の都市名をクリックすると、3時間ごと・週間予報を含む詳しい天気情報が表示されます。</p>
        </div>
      `;
      return;
    }
    const { city, w } = entry;
    const safeW = ensureWeatherForecasts(w);
    elWeatherDetailPanel.innerHTML = `
      <div class="weather-detail-head">
        <span class="weather-detail-city">${escapeHtml(city.name)}</span>
        <span class="weather-city-region">${escapeHtml(city.region)}</span>
      </div>
      <div class="weather-detail-main">
        <span class="weather-detail-icon">${safeW.meta.icon}</span>
        <div>
          <div class="weather-detail-temp">${safeW.temp}°C</div>
          <div class="weather-detail-label">${escapeHtml(safeW.meta.label)}</div>
        </div>
      </div>
      <div class="weather-detail-grid">
        <div class="weather-detail-stat">
          <span class="weather-detail-stat-label">最高気温</span>
          <span class="weather-detail-stat-val">${safeW.maxTemp}°C</span>
        </div>
        <div class="weather-detail-stat">
          <span class="weather-detail-stat-label">最低気温</span>
          <span class="weather-detail-stat-val">${safeW.minTemp}°C</span>
        </div>
        <div class="weather-detail-stat">
          <span class="weather-detail-stat-label">降水確率</span>
          <span class="weather-detail-stat-val">☔ ${safeW.pop}%</span>
        </div>
        <div class="weather-detail-stat">
          <span class="weather-detail-stat-label">風速</span>
          <span class="weather-detail-stat-val">🍃 ${safeW.wind} km/h</span>
        </div>
      </div>
      ${renderWeatherForecastBlocksHtml(safeW)}
    `;
  }

  function renderCityWeatherMap(cityResults) {
    weatherState.cityResults = cityResults;
    if (!elWeatherMapPins) return;
    elWeatherMapPins.innerHTML = cityResults
      .map(({ city, w }) => {
        const isActive = weatherState.selectedCityName === city.name ? "active" : "";
        return `
          <button
            type="button"
            class="weather-map-pin ${isActive}"
            data-city-name="${escapeHtml(city.name)}"
            style="left: ${city.x}%; top: ${city.y}%;"
            aria-label="${escapeHtml(city.name)} ${escapeHtml(w.meta.label)} ${w.temp}°C"
          >
            <span class="pin-city">${escapeHtml(city.name)}</span>
            <span class="pin-weather">${w.meta.icon}<span class="pin-temp">${w.temp}°</span></span>
          </button>
        `;
      })
      .join("");

    if (weatherState.selectedCityName) {
      const selected = cityResults.find((r) => r.city.name === weatherState.selectedCityName);
      renderCityDetailPanel(selected);
    } else {
      renderCityDetailPanel(null);
    }
  }

  function buildPreloadedCityResults() {
    const preloaded = getBestAvailableWeatherCities(state.data);
    const byName = new Map(preloaded.map((c) => [c.name, c]));
    return MAJOR_JP_CITIES.map((city) => {
      const p = byName.get(city.name) || DEFAULT_WEATHER_CITIES.find((d) => d.name === city.name);
      if (!p) return null;
      const code = Number.isFinite(Number(p.code)) ? Math.round(Number(p.code)) : 0;
      return {
        city,
        w: ensureWeatherForecasts({
          temp: p.temp,
          wind: p.wind ?? 0,
          code,
          meta: getWeatherMeta(code),
          maxTemp: p.maxTemp ?? p.temp,
          minTemp: p.minTemp ?? p.temp,
          pop: p.pop ?? 0,
          hourly: p.hourly,
          daily: p.daily,
        }),
      };
    }).filter(Boolean);
  }

  async function fetchSingleLocationWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=7`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(url, {}, 8000);
        if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
        const data = await res.json();
        return parseWeatherItem(data);
      } catch (err) {
        if (attempt === 1) throw err;
      }
    }
  }

  async function fetchAllCitiesOpenMeteoBatch() {
    const lats = MAJOR_JP_CITIES.map((c) => c.lat).join(",");
    const lons = MAJOR_JP_CITIES.map((c) => c.lon).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=7`;
    const res = await fetchWithTimeout(url, {}, 9000);
    if (!res.ok) throw new Error(`Open-Meteo batch HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    const results = new Map();
    MAJOR_JP_CITIES.forEach((city, idx) => {
      const entry = list[idx];
      if (entry && entry.current) {
        results.set(city.name, { city, w: parseWeatherItem(entry) });
      }
    });
    return results;
  }

  async function fetchAndRenderAllWeather(forceRefresh = false) {
    if (weatherState.isFetching) return;
    if (!forceRefresh && Date.now() - weatherState.lastFetchAt < 10 * 60 * 1000 && weatherState.lastFetchAt > 0) {
      return;
    }
    weatherState.isFetching = true;

    try {
      const loc = weatherState.currentLoc || getSavedLocation();
      weatherState.currentLoc = loc;
      const nearestCity = findNearestMajorCity(loc.lat, loc.lon);

      // Step 1: 保護済み事前データ（または内蔵デフォルト）で主要11都市＋現在地カードを0秒即描画
      const preloadedResults = buildPreloadedCityResults();
      renderCityWeatherMap(preloadedResults);
      const instantCurrent = preloadedResults.find((r) => r.city.name === nearestCity.name) || preloadedResults[0];
      if (instantCurrent) {
        renderCurrentWeatherCard(loc, instantCurrent.w);
      }
      if (elWeatherUpdatedLabel) {
        elWeatherUpdatedLabel.textContent = `更新: ${state.data?.updatedAt || formatNowJst().updatedAt}`;
      }

      // Step 2: 現在地の天気を最新化（Open-Meteo -> 気象庁 -> 事前データの多段フォールバック）
      let liveUpdated = false;
      try {
        const currentWeather = await fetchSingleLocationWeather(loc.lat, loc.lon);
        renderCurrentWeatherCard(loc, currentWeather);
        liveUpdated = true;
      } catch (_e) {
        try {
          const jmaCurrent = await fetchCityWeatherFromJma(nearestCity, instantCurrent?.w);
          renderCurrentWeatherCard(loc, jmaCurrent);
          liveUpdated = true;
        } catch (_e2) {}
      }

      // Step 3: 主要11都市を最新化（Open-Meteo 1回一括取得 -> 欠損分は気象庁APIで補完）
      const shouldRefreshCities =
        forceRefresh ||
        weatherState.lastFetchAt === 0 ||
        !Array.isArray(state.data?.weatherCities) ||
        state.data.weatherCities.length === 0;

      if (shouldRefreshCities) {
        const merged = new Map(preloadedResults.map((r) => [r.city.name, r]));
        let batchMap = new Map();
        try {
          batchMap = await fetchAllCitiesOpenMeteoBatch();
          batchMap.forEach((val, key) => {
            merged.set(key, val);
            liveUpdated = true;
          });
        } catch (_e) {}

        const missingCities = MAJOR_JP_CITIES.filter((c) => !batchMap.has(c.name));
        if (missingCities.length > 0) {
          const jmaSettled = await Promise.allSettled(
            missingCities.map((city) =>
              fetchCityWeatherFromJma(city, merged.get(city.name)?.w).then((w) => ({ city, w }))
            )
          );
          jmaSettled.forEach((r) => {
            if (r.status === "fulfilled") {
              merged.set(r.value.city.name, r.value);
              liveUpdated = true;
            }
          });
        }

        const cityResults = MAJOR_JP_CITIES.map((c) => merged.get(c.name)).filter(Boolean);
        renderCityWeatherMap(cityResults);

        if (liveUpdated) {
          const nowUpdated = formatNowJst().updatedAt;
          const serializedCities = cityResults.map(({ city, w }) => ({
            name: city.name,
            region: city.region,
            temp: w.temp,
            code: w.code ?? 0,
            wind: w.wind ?? 0,
            maxTemp: w.maxTemp ?? w.temp,
            minTemp: w.minTemp ?? w.temp,
            pop: w.pop ?? 0,
            hourly: w.hourly,
            daily: w.daily,
          }));
          saveCachedWeatherCities(serializedCities, nowUpdated);
          state.data.weatherCities = serializedCities;
          safeStorageSet(localStorage, "trend-news-live-cache", JSON.stringify(state.data));
          if (elWeatherUpdatedLabel) {
            elWeatherUpdatedLabel.textContent = `更新: ${nowUpdated}`;
          }
        }
      }

      weatherState.lastFetchAt = Date.now();
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

  // Settings Modal (My Topics & Category Order)
  function renderSettingsModalContent() {
    applyFontSize(state.fontSize);

    if (elMyTopicsList) {
      if (state.myTopics.length === 0) {
        elMyTopicsList.innerHTML = `<span class="settings-desc">まだ登録されていません。上の入力欄から追加できます。</span>`;
      } else {
        elMyTopicsList.innerHTML = state.myTopics
          .map(
            (t) => `
              <span class="topic-pill">
                📌 ${escapeHtml(t)}
                <button type="button" data-remove-topic="${escapeHtml(t)}" aria-label="${escapeHtml(t)}を削除">✕</button>
              </span>
            `
          )
          .join("");
      }
    }

    if (elCategoryOrderList) {
      const hiddenSet = new Set(state.catPrefs.hidden);
      const order = state.catPrefs.order;
      elCategoryOrderList.innerHTML = order
        .map((cat, idx) => {
          const meta = getCategoryMeta(cat);
          const isAll = cat === "all";
          const isVisible = isAll || !hiddenSet.has(cat);
          return `
            <div class="cat-order-row" data-cat-row="${escapeHtml(cat)}">
              <label class="cat-order-label">
                <input type="checkbox" data-toggle-cat="${escapeHtml(cat)}" ${isVisible ? "checked" : ""} ${isAll ? "disabled" : ""} />
                <span>${meta.icon} ${escapeHtml(meta.label)}</span>
              </label>
              <div class="cat-order-actions">
                <button type="button" class="cat-move-btn" data-move-cat="${escapeHtml(cat)}" data-dir="-1" ${idx === 0 ? "disabled" : ""} aria-label="上へ移動">↑</button>
                <button type="button" class="cat-move-btn" data-move-cat="${escapeHtml(cat)}" data-dir="1" ${idx === order.length - 1 ? "disabled" : ""} aria-label="下へ移動">↓</button>
              </div>
            </div>
          `;
        })
        .join("");
    }
  }

  function openSettingsModal() {
    if (!elSettingsModal) return;
    renderSettingsModalContent();
    elSettingsModal.hidden = false;
    syncBodyScrollLock();
  }

  function closeSettingsModal() {
    if (!elSettingsModal) return;
    elSettingsModal.hidden = true;
    syncBodyScrollLock();
  }

  function addMyTopicFromInput() {
    if (!elMyTopicInput) return;
    const val = elMyTopicInput.value.trim();
    if (!val) return;
    if (!state.myTopics.some((t) => t.toLowerCase() === val.toLowerCase())) {
      state.myTopics.push(val);
      syncMyTopicsPairs();
      safeStorageSet(localStorage, MY_TOPICS_STORAGE_KEY, JSON.stringify(state.myTopics));
    }
    elMyTopicInput.value = "";
    renderSettingsModalContent();
    renderTrending();
    renderFeed();
  }

  // Theme
  function initTheme() {
    const saved =
      safeStorageGet(localStorage, "trend-news-theme") ||
      safeStorageGet(localStorage, "morning-news-theme");
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
    safeStorageSet(localStorage, "trend-news-theme", next);
  }

  function renderAll() {
    elHeaderUpdated.textContent = `更新: ${state.data.updatedAt || state.data.date || "--"}`;
    syncHeaderWeatherIcon();
    renderTrending();
    renderFeed();
  }

  // Events
  document.addEventListener(
    "error",
    (e) => {
      const target = e?.target;
      if (!target || target.tagName !== "IMG") return;
      const fb = target.getAttribute("data-fallback-src");
      if (fb && target.getAttribute("src") !== fb) {
        target.removeAttribute("data-fallback-src");
        target.setAttribute("src", fb);
      }
    },
    true
  );

  elMainContainer?.addEventListener("click", (e) => {
    const bmBtn = e?.target?.closest?.("[data-bookmark-url]");
    if (bmBtn) {
      e.stopPropagation?.();
      const bmUrl = bmBtn.getAttribute("data-bookmark-url") || "";
      toggleBookmarkByUrl(bmUrl);
      return;
    }
    const card = e?.target?.closest?.("[data-article-idx]");
    if (!card) return;
    const idx = Number(card.getAttribute("data-article-idx"));
    const url = card.getAttribute("data-article-url") || "";
    openArticleModal(idx, url);
  });

  elMainContainer?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e?.target?.closest?.("[data-bookmark-url], button, a, input")) return;
    const card = e?.target?.closest?.("[data-article-idx]");
    if (!card) return;
    e.preventDefault?.();
    const idx = Number(card.getAttribute("data-article-idx"));
    const url = card.getAttribute("data-article-url") || "";
    openArticleModal(idx, url);
  });

  elModalContent?.addEventListener("click", (e) => {
    const bmBtn = e?.target?.closest?.("#btn-modal-bookmark");
    if (bmBtn) {
      const bmUrl = bmBtn.getAttribute("data-bookmark-url") || "";
      const nowSaved = toggleBookmarkByUrl(bmUrl);
      bmBtn.classList.toggle("active", nowSaved);
      bmBtn.textContent = nowSaved ? "★ 保存済み" : "☆ あとで読む";
      return;
    }
    const copyBtn = e?.target?.closest?.("#btn-modal-copy");
    if (copyBtn) {
      const shareUrl = copyBtn.getAttribute("data-share-url") || "";
      if (shareUrl) {
        copyTextToClipboard(shareUrl, () => {
          copyBtn.textContent = "✓ コピーしました";
        });
      }
      return;
    }
    const shareBtn = e?.target?.closest?.("#btn-modal-share");
    if (shareBtn) {
      const shareUrl = shareBtn.getAttribute("data-share-url") || "";
      const shareTitle = shareBtn.getAttribute("data-share-title") || "TREND NEWS";
      if (navigator.share && typeof navigator.share === "function") {
        navigator.share({ title: shareTitle, text: shareTitle, url: shareUrl }).catch(() => {});
      } else if (shareUrl) {
        copyTextToClipboard(shareUrl, () => {
          shareBtn.textContent = "✓ URLをコピーしました";
        });
      }
    }
  });

  elTrendingTags?.addEventListener("click", (e) => {
    const openBtn = e?.target?.closest?.("[data-open-settings]");
    if (openBtn) {
      openSettingsModal();
      return;
    }
    const chip = e?.target?.closest?.(".trending-chip");
    if (!chip) return;
    const kw = chip.getAttribute("data-kw") || "";
    if (!kw) return;
    if (state.query.trim().toLowerCase() === kw.toLowerCase()) {
      setQuery("");
    } else {
      setQuery(kw);
    }
  });

  elWeatherMapPins?.addEventListener("click", (e) => {
    const btn = e?.target?.closest?.(".weather-map-pin");
    if (!btn) return;
    const name = btn.getAttribute("data-city-name");
    weatherState.selectedCityName = name;
    elWeatherMapPins.querySelectorAll(".weather-map-pin").forEach((p) => {
      p.classList.toggle("active", p.getAttribute("data-city-name") === name);
    });
    const found = weatherState.cityResults.find((r) => r.city.name === name);
    renderCityDetailPanel(found);
    if (window.innerWidth <= 960 && elWeatherDetailPanel) {
      elWeatherDetailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  navTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setCategory(tab.getAttribute("data-category"));
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
    setCategory("all", 0, true, true);
  });
  elBrandReset.addEventListener("click", (e) => {
    e.preventDefault();
    setCategory("all", 0, true, true);
  });

  elBtnWeatherShortcut?.addEventListener("click", () => {
    setCategory("weather");
  });

  elBtnUnreadOnly?.addEventListener("click", () => {
    state.unreadOnly = !state.unreadOnly;
    renderFeed();
  });

  elBtnFontSize?.addEventListener("click", cycleFontSize);
  elBtnSettings?.addEventListener("click", openSettingsModal);
  elSettingsClose?.addEventListener("click", closeSettingsModal);
  elSettingsBackdrop?.addEventListener("click", closeSettingsModal);

  elFontSizeOptions?.addEventListener("click", (e) => {
    const btn = e?.target?.closest?.("[data-set-font]");
    if (!btn) return;
    applyFontSize(btn.getAttribute("data-set-font"));
  });

  elBtnAddTopic?.addEventListener("click", addMyTopicFromInput);
  elMyTopicInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMyTopicFromInput();
    }
  });

  elMyTopicsList?.addEventListener("click", (e) => {
    const rmBtn = e?.target?.closest?.("[data-remove-topic]");
    if (!rmBtn) return;
    const topic = rmBtn.getAttribute("data-remove-topic");
    state.myTopics = state.myTopics.filter((t) => t !== topic);
    syncMyTopicsPairs();
    safeStorageSet(localStorage, MY_TOPICS_STORAGE_KEY, JSON.stringify(state.myTopics));
    renderSettingsModalContent();
    renderTrending();
    renderFeed();
  });

  elCategoryOrderList?.addEventListener("click", (e) => {
    const moveBtn = e?.target?.closest?.("[data-move-cat]");
    if (moveBtn) {
      const cat = moveBtn.getAttribute("data-move-cat");
      const dir = Number(moveBtn.getAttribute("data-dir"));
      const idx = state.catPrefs.order.indexOf(cat);
      const nextIdx = idx + dir;
      if (idx >= 0 && nextIdx >= 0 && nextIdx < state.catPrefs.order.length) {
        const copy = [...state.catPrefs.order];
        const [item] = copy.splice(idx, 1);
        copy.splice(nextIdx, 0, item);
        state.catPrefs.order = copy;
        safeStorageSet(localStorage, CAT_PREFS_STORAGE_KEY, JSON.stringify(state.catPrefs));
        applyCategoryPreferences();
        renderSettingsModalContent();
      }
      return;
    }
    const toggleInput = e?.target?.closest?.("[data-toggle-cat]");
    if (toggleInput) {
      const cat = toggleInput.getAttribute("data-toggle-cat");
      if (cat && cat !== "all") {
        const hiddenSet = new Set(state.catPrefs.hidden);
        if (toggleInput.checked) {
          hiddenSet.delete(cat);
        } else {
          hiddenSet.add(cat);
        }
        state.catPrefs.hidden = Array.from(hiddenSet);
        safeStorageSet(localStorage, CAT_PREFS_STORAGE_KEY, JSON.stringify(state.catPrefs));
        applyCategoryPreferences();
        syncCategoryTabsUI(state.category, true);
        renderFeed();
      }
    }
  });

  elBtnResetPrefs?.addEventListener("click", () => {
    state.catPrefs = { order: [...DEFAULT_CATEGORY_ORDER], hidden: [] };
    safeStorageSet(localStorage, CAT_PREFS_STORAGE_KEY, JSON.stringify(state.catPrefs));
    applyCategoryPreferences();
    renderSettingsModalContent();
    syncCategoryTabsUI(state.category, true);
  });

  elBtnRefresh.addEventListener("click", () => reloadNewsData(true));
  elBtnTheme.addEventListener("click", toggleTheme);
  elModalClose.addEventListener("click", closeModal);
  elModalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!elModal.hidden) closeModal();
      if (elSettingsModal && !elSettingsModal.hidden) closeSettingsModal();
    }
  });

  function setupMobileSwipeNavigation() {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    document.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) {
          tracking = false;
          return;
        }
        if ((elModal && !elModal.hidden) || (elSettingsModal && !elSettingsModal.hidden)) {
          tracking = false;
          return;
        }
        const target = e.target;
        if (target && target.closest(".category-nav, .trending-inner, .weather-hourly-strip, .weather-daily-list, input, textarea, select")) {
          tracking = false;
          return;
        }
        const t = e.touches[0];
        if (t.clientX < 24 || t.clientX > window.innerWidth - 24) {
          tracking = false;
          return;
        }
        startX = t.clientX;
        startY = t.clientY;
        startTime = Date.now();
        tracking = true;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchcancel",
      () => {
        tracking = false;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      (e) => {
        if (!tracking || !e.changedTouches || e.changedTouches.length === 0) return;
        tracking = false;

        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const dt = Date.now() - startTime;

        if (dt > 650) return;
        if (Math.abs(dx) < 60 || Math.abs(dy) > 80) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.4) return;

        const categoryOrder = getActiveCategoryOrder();
        const currentIdx = categoryOrder.indexOf(state.category);
        if (currentIdx === -1) return;

        const dir = dx < 0 ? 1 : -1;
        const nextIdx = currentIdx + dir;
        if (nextIdx < 0 || nextIdx >= categoryOrder.length) return;

        setCategory(categoryOrder[nextIdx], dir);
      },
      { passive: true }
    );
  }

  // Init
  initTheme();
  applyFontSize(state.fontSize);
  applyCategoryPreferences();
  setupMobileSwipeNavigation();
  state.data = { ...state.data, items: normalizeNewsItems(state.data.items) };
  state.lastDataSignature = computeDataSignature(state.data);
  restoreCachedNewsOnStartup();
  syncCategoryTabsUI(state.category, true);
  renderAll();
  reloadNewsData(false);
  if (typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  setInterval(() => reloadNewsData(false), 5 * 60 * 1000);
  setInterval(() => {
    if (state.category === "weather") fetchAndRenderAllWeather(true);
  }, 30 * 60 * 1000);
})();

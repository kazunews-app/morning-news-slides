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

  function getCategoryMeta(cat) {
    return CATEGORY_META[cat] || { label: "ニュース", icon: "📰", fallbackImg: "assets/images/news-1.jpg" };
  }

  function getFallbackImage(item, index = 0) {
    if (item.category === "domestic") {
      return index % 2 === 0 ? "assets/images/news-1.jpg" : "assets/images/news-2.jpg";
    }
    if (item.category === "tech") {
      return index % 2 === 0 ? "assets/images/news-3.jpg" : "assets/images/news-4.jpg";
    }
    return index % 2 === 0 ? "assets/images/news-5.jpg" : "assets/images/news-6.jpg";
  }

  function formatRelativeTime(item) {
    if (item.publishedTs) {
      const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - item.publishedTs);
      if (diffSec < 60) return "たった今";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
      return `${Math.floor(diffSec / 86400)}日前`;
    }
    return item.publishedAt || "";
  }

  function updateCounts() {
    const items = state.data.items || [];
    const counts = { all: items.length, domestic: 0, tech: 0, business: 0 };
    items.forEach((it) => {
      if (counts[it.category] !== undefined) counts[it.category] += 1;
    });
    document.getElementById("count-all").textContent = counts.all;
    document.getElementById("count-domestic").textContent = counts.domestic;
    document.getElementById("count-tech").textContent = counts.tech;
    document.getElementById("count-business").textContent = counts.business;
  }

  function renderTrending() {
    const keywords = state.data.keywords || [];
    elTrendingTags.innerHTML = keywords
      .map((kw) => {
        const active = state.query.toLowerCase() === kw.toLowerCase() ? "active" : "";
        return `<button type="button" class="trending-chip ${active}" data-kw="${escapeHtml(kw)}"># ${escapeHtml(kw)}</button>`;
      })
      .join("");

    elTrendingTags.querySelectorAll(".trending-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kw = btn.getAttribute("data-kw");
        if (state.query === kw) {
          setQuery("");
        } else {
          setQuery(kw);
        }
      });
    });
  }

  function getFilteredItems() {
    const items = state.data.items || [];
    const q = state.query.trim().toLowerCase();
    return items.filter((item) => {
      if (state.category !== "all" && item.category !== state.category) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.title,
        item.summary,
        item.source,
        item.impact,
        ...(item.tags || []),
        ...(item.points || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  function renderHero(items) {
    const lead = items[0];
    const sideItems = items.slice(1, 5);
    const leadMeta = getCategoryMeta(lead.category);
    const leadImg = lead.image || getFallbackImage(lead, 0);
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
        const img = item.image || getFallbackImage(item, i + 1);
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
    const allWithIdx = (state.data.items || []).map((item, idx) => ({ ...item, _idx: idx }));
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
        ...(item.tags || []),
        ...(item.points || []),
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
          const img = item.image || getFallbackImage(item, i);
          const fb = getFallbackImage(item, i);
          const tagsHtml = (item.tags || [])
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

    // Bind click handlers for articles
    document.querySelectorAll("[data-article-idx]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.getAttribute("data-article-idx"));
        openArticleModal(idx);
      });
    });
  }

  function openArticleModal(idx) {
    const item = (state.data.items || [])[idx];
    if (!item) return;

    const meta = getCategoryMeta(item.category);
    const img = item.image || getFallbackImage(item, idx);
    const fb = getFallbackImage(item, idx);
    const pointsHtml = (item.points || [])
      .map((pt) => `<li>${escapeHtml(pt)}</li>`)
      .join("");
    const tagsHtml = (item.tags || [])
      .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
      .join("");

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

        ${pointsHtml
        ? `<div class="modal-box">
                <h3>📌 3つの要点</h3>
                <ul class="modal-points">${pointsHtml}</ul>
              </div>`
        : ""
      }

        ${item.impact
        ? `<div class="modal-box">
                <h3>💡 注目ポイント・影響</h3>
                <p class="modal-impact">${escapeHtml(item.impact)}</p>
              </div>`
        : ""
      }

        <div class="modal-actions">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>
          ${item.url
        ? `<a class="read-original-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">元記事を読む ↗</a>`
        : ""
      }
        </div>
      </div>
    `;

    elModal.hidden = false;
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

  async function reloadNewsData() {
    elBtnRefresh.classList.add("spinning");
    const ts = Date.now();
    const urls = [
      `https://raw.githubusercontent.com/sjhkazu1011-ctrl/morning-news-slides/main/data/news.js?t=${ts}`,
      `data/news.js?t=${ts}`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        const parsed = parseNewsJsText(text);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          if (!state.data.updatedAt || parsed.updatedAt >= state.data.updatedAt || url.startsWith("https://")) {
            window.NEWS_DATA = parsed;
            state.data = parsed;
            renderAll();
          }
          break;
        }
      } catch (_err) {
        // Fallback to next URL
      }
    }
    elBtnRefresh.classList.remove("spinning");
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
      const res = await fetch(url);
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
      const res = await fetch(url);
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

  function requestGeolocationWeather(isUserTap = false) {
    if (!navigator.geolocation) {
      elWeatherSub.textContent = "位置情報非対応";
      return;
    }
    if (isUserTap) {
      elWeatherSub.textContent = "現在地を取得中...";
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const locName = await resolveLocationName(lat, lon);
        localStorage.setItem("trend-news-geo", JSON.stringify({ lat, lon, locName }));
        await fetchAndRenderWeather(lat, lon, locName);
      },
      (_err) => {
        if (isUserTap) {
          elWeatherSub.textContent = "位置情報の許可が必要です(東京を表示)";
        }
        fetchAndRenderWeather(35.6812, 139.7671, "東京");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }

  function initWeather() {
    if (elWeatherWidget) {
      elWeatherWidget.addEventListener("click", () => requestGeolocationWeather(true));
    }
    try {
      const saved = JSON.parse(localStorage.getItem("trend-news-geo") || "null");
      if (saved && saved.lat && saved.lon) {
        fetchAndRenderWeather(saved.lat, saved.lon, saved.locName || "現在地");
        requestGeolocationWeather(false);
        return;
      }
    } catch (_e) {}
    // 初回は仮で東京を表示しつつ現在地をリクエスト
    fetchAndRenderWeather(35.6812, 139.7671, "東京");
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

  elBtnRefresh.addEventListener("click", reloadNewsData);
  elBtnTheme.addEventListener("click", toggleTheme);
  elModalClose.addEventListener("click", closeModal);
  elModalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !elModal.hidden) closeModal();
  });

  // Init
  initTheme();
  initWeather();
  renderAll();
  reloadNewsData();
  setInterval(reloadNewsData, 5 * 60 * 1000);
})();

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

  function reloadNewsData() {
    elBtnRefresh.classList.add("spinning");
    const script = document.createElement("script");
    script.src = `data/news.js?t=${Date.now()}`;
    script.onload = () => {
      elBtnRefresh.classList.remove("spinning");
      if (window.NEWS_DATA) {
        state.data = window.NEWS_DATA;
        renderAll();
      }
      script.remove();
    };
    script.onerror = () => {
      elBtnRefresh.classList.remove("spinning");
      script.remove();
    };
    document.body.appendChild(script);
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
  renderAll();
})();

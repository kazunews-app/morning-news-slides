(() => {
  const AUTOPLAY_INTERVAL_MS = 8000;

  const CATEGORY_META = {
    domestic: { label: "国内・総合", icon: "🇯🇵" },
    tech: { label: "テクノロジー・AI", icon: "🤖" },
    business: { label: "ビジネス・経済", icon: "📈" },
  };

  const state = {
    rawData: window.NEWS_DATA || { date: "--", updatedAt: "--", items: [] },
    category: "all",
    slides: [],
    currentIndex: 0,
    isAutoplaying: false,
    autoplayTimer: null,
    autoplayStart: 0,
    autoplayRaf: null,
  };

  // DOM Elements
  const elHeaderDate = document.getElementById("header-date");
  const elSlideContainer = document.getElementById("slide-container");
  const elProgressFill = document.getElementById("progress-fill");
  const elAutoplayTrack = document.getElementById("autoplay-track");
  const elAutoplayFill = document.getElementById("autoplay-fill");
  const elCurrentIndex = document.getElementById("current-index");
  const elTotalSlides = document.getElementById("total-slides");
  const elBtnPrev = document.getElementById("btn-prev");
  const elBtnNext = document.getElementById("btn-next");
  const elBtnAutoplay = document.getElementById("btn-autoplay");
  const elAutoplayLabel = document.getElementById("autoplay-label");
  const elBtnTheme = document.getElementById("btn-theme");
  const elBtnFullscreen = document.getElementById("btn-fullscreen");
  const elBtnOverview = document.getElementById("btn-overview");
  const elOverviewModal = document.getElementById("overview-modal");
  const elOverviewBackdrop = document.getElementById("overview-backdrop");
  const elBtnCloseOverview = document.getElementById("btn-close-overview");
  const elOverviewGrid = document.getElementById("overview-grid");
  const filterButtons = document.querySelectorAll(".filter-btn");

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildSlides() {
    const items = state.rawData.items || [];
    const filtered =
      state.category === "all"
        ? items
        : items.filter((item) => item.category === state.category);

    const slides = [];

    // 1. Cover Slide
    slides.push({
      type: "cover",
      title: state.rawData.title || "今日のトレンドニュース",
      date: state.rawData.date || "--",
      updatedAt: state.rawData.updatedAt || "--",
      count: filtered.length,
      keywords: state.rawData.keywords || [],
    });

    // 2. News Slides
    filtered.forEach((item) => {
      slides.push({
        type: "news",
        ...item,
      });
    });

    // 3. Summary Slide
    slides.push({
      type: "summary",
      items: filtered,
    });

    state.slides = slides;
    if (state.currentIndex >= slides.length) {
      state.currentIndex = 0;
    }
  }

  function renderSlide() {
    const slide = state.slides[state.currentIndex];
    const total = state.slides.length;

    elCurrentIndex.textContent = state.currentIndex + 1;
    elTotalSlides.textContent = total;
    elProgressFill.style.width = `${((state.currentIndex + 1) / total) * 100}%`;

    elBtnPrev.disabled = state.currentIndex === 0;
    elBtnNext.disabled = state.currentIndex === total - 1;

    if (!slide) {
      elSlideContainer.innerHTML = `<div class="slide-card"><p>ニュースデータが見つかりません。</p></div>`;
      return;
    }

    if (slide.type === "cover") {
      const tagsHtml = (slide.keywords || [])
        .map((kw) => `<span class="cover-tag"># ${escapeHtml(kw)}</span>`)
        .join("");

      elSlideContainer.innerHTML = `
        <section class="slide-card slide-cover">
          <div class="cover-greeting">☀️ おはようございます ・ ${escapeHtml(slide.date)}</div>
          <h1 class="cover-title">${escapeHtml(slide.title)}</h1>
          <p class="cover-subtitle">
            今朝押さえておきたい重要トピック <strong>${slide.count}件</strong> をスライド形式でまとめました。
            （最終更新: ${escapeHtml(slide.updatedAt)}）
          </p>
          ${tagsHtml ? `<div class="cover-tags">${tagsHtml}</div>` : ""}
          <button class="cover-cta" id="cover-start-btn">
            <span>スライドを始める</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </section>
      `;

      const startBtn = document.getElementById("cover-start-btn");
      if (startBtn) {
        startBtn.addEventListener("click", () => goToSlide(1));
      }
      return;
    }

    if (slide.type === "summary") {
      const itemsHtml = slide.items
        .map((item, idx) => {
          const meta = CATEGORY_META[item.category] || { label: "ニュース", icon: "📰" };
          return `
            <button class="summary-item" data-target-index="${idx + 1}">
              <div class="summary-item-cat">${meta.icon} ${escapeHtml(meta.label)}</div>
              <div class="summary-item-title">${escapeHtml(item.title)}</div>
            </button>
          `;
        })
        .join("");

      elSlideContainer.innerHTML = `
        <section class="slide-card">
          <div>
            <div class="slide-meta">
              <span class="category-badge tech">✨ 本日のまとめ</span>
              <span class="slide-number-pill">${state.currentIndex + 1} / ${total}</span>
            </div>
            <h2 class="news-title" style="margin-top: 16px;">今朝のトピック振り返り</h2>
            <p class="news-lead" style="margin-top: 8px;">気になるニュースをクリックすると該当スライドへ戻れます。</p>
          </div>
          <div class="summary-list">
            ${itemsHtml || "<p>該当するニュースはありません。</p>"}
          </div>
          <div class="slide-footer">
            <span class="slide-source">今日も良い一日をお過ごしください！</span>
            <button class="nav-btn" id="summary-restart-btn">最初から見直す ↺</button>
          </div>
        </section>
      `;

      document.querySelectorAll(".summary-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-target-index"));
          goToSlide(idx);
        });
      });
      const restartBtn = document.getElementById("summary-restart-btn");
      if (restartBtn) {
        restartBtn.addEventListener("click", () => goToSlide(0));
      }
      return;
    }

    // News Slide
    const meta = CATEGORY_META[slide.category] || { label: "ニュース", icon: "📰" };
    const pointsHtml = (slide.points || [])
      .map((pt) => `<li>${escapeHtml(pt)}</li>`)
      .join("");
    const tagsHtml = (slide.tags || [])
      .map((tag) => `<span class="slide-tag">#${escapeHtml(tag)}</span>`)
      .join("");
    const linkHtml = slide.url
      ? `<a class="source-link" href="${escapeHtml(slide.url)}" target="_blank" rel="noopener noreferrer">元記事・詳細を読む ↗</a>`
      : `<span class="slide-source">出典: ${escapeHtml(slide.source || "ニュースまとめ")}</span>`;

    const fallbackImageByCat = {
      domestic: "assets/images/news-1.jpg",
      tech: "assets/images/news-3.jpg",
      business: "assets/images/news-5.jpg",
    };
    const imageSrc = slide.image || fallbackImageByCat[slide.category] || "";
    const mediaHtml = imageSrc
      ? `<div class="news-media"><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(slide.title)}" loading="lazy" onerror="this.parentElement.style.display='none'" /></div>`
      : "";

    elSlideContainer.innerHTML = `
      <article class="slide-card">
        <div class="slide-meta">
          <div class="meta-left">
            <span class="category-badge ${escapeHtml(slide.category)}">${meta.icon} ${escapeHtml(meta.label)}</span>
            <span class="slide-source">${escapeHtml(slide.source || "")}${slide.publishedAt ? ` ・ ${escapeHtml(slide.publishedAt)}` : ""}</span>
          </div>
          <span class="slide-number-pill">${state.currentIndex + 1} / ${total}</span>
        </div>

        <div class="slide-body">
          <div class="news-hero">
            <div class="news-hero-text">
              <h2 class="news-title">${escapeHtml(slide.title)}</h2>
              <p class="news-lead">${escapeHtml(slide.summary)}</p>
            </div>
            ${mediaHtml}
          </div>

          <div class="points-grid">
            <div class="points-box">
              <div class="box-heading">📌 3つのポイント</div>
              <ul class="points-list">${pointsHtml}</ul>
            </div>
            <div class="impact-box">
              <div class="box-heading">💡 ここが注目・影響</div>
              <p class="impact-text">${escapeHtml(slide.impact || "今後の動向に注目が集まっています。")}</p>
            </div>
          </div>
        </div>

        <div class="slide-footer">
          ${linkHtml}
          <div class="slide-tags">${tagsHtml}</div>
        </div>
      </article>
    `;
  }

  function goToSlide(index) {
    const max = state.slides.length - 1;
    state.currentIndex = Math.max(0, Math.min(index, max));
    renderSlide();
    if (state.isAutoplaying) {
      resetAutoplayCycle();
    }
  }

  function nextSlide() {
    if (state.currentIndex < state.slides.length - 1) {
      goToSlide(state.currentIndex + 1);
    } else if (state.isAutoplaying) {
      goToSlide(0);
    }
  }

  function prevSlide() {
    if (state.currentIndex > 0) {
      goToSlide(state.currentIndex - 1);
    }
  }

  // Autoplay
  function startAutoplay() {
    state.isAutoplaying = true;
    elBtnAutoplay.classList.add("playing");
    elAutoplayLabel.textContent = "再生中";
    elAutoplayTrack.classList.add("active");
    resetAutoplayCycle();
  }

  function stopAutoplay() {
    state.isAutoplaying = false;
    elBtnAutoplay.classList.remove("playing");
    elAutoplayLabel.textContent = "自動再生";
    elAutoplayTrack.classList.remove("active");
    elAutoplayFill.style.width = "0%";
    clearTimeout(state.autoplayTimer);
    cancelAnimationFrame(state.autoplayRaf);
  }

  function resetAutoplayCycle() {
    clearTimeout(state.autoplayTimer);
    cancelAnimationFrame(state.autoplayRaf);
    state.autoplayStart = performance.now();

    const tick = (now) => {
      if (!state.isAutoplaying) return;
      const elapsed = now - state.autoplayStart;
      const pct = Math.min(100, (elapsed / AUTOPLAY_INTERVAL_MS) * 100);
      elAutoplayFill.style.width = `${pct}%`;
      if (elapsed < AUTOPLAY_INTERVAL_MS) {
        state.autoplayRaf = requestAnimationFrame(tick);
      }
    };
    state.autoplayRaf = requestAnimationFrame(tick);

    state.autoplayTimer = setTimeout(() => {
      nextSlide();
    }, AUTOPLAY_INTERVAL_MS);
  }

  function toggleAutoplay() {
    if (state.isAutoplaying) {
      stopAutoplay();
    } else {
      startAutoplay();
    }
  }

  // Overview Modal
  function openOverview() {
    elOverviewGrid.innerHTML = state.slides
      .map((s, idx) => {
        let label = "表紙";
        let title = s.title || "Morning Briefing";
        if (s.type === "news") {
          const meta = CATEGORY_META[s.category] || { label: "ニュース", icon: "📰" };
          label = `${meta.icon} ${meta.label}`;
        } else if (s.type === "summary") {
          label = "✨ まとめ";
          title = "今朝のトピック振り返り";
        }
        return `
          <button class="overview-card ${idx === state.currentIndex ? "current" : ""}" data-idx="${idx}">
            <span class="overview-card-num">Slide ${idx + 1} ・ ${escapeHtml(label)}</span>
            <span class="overview-card-title">${escapeHtml(title)}</span>
          </button>
        `;
      })
      .join("");

    elOverviewGrid.querySelectorAll(".overview-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = Number(card.getAttribute("data-idx"));
        closeOverview();
        goToSlide(idx);
      });
    });

    elOverviewModal.hidden = false;
  }

  function closeOverview() {
    elOverviewModal.hidden = true;
  }

  // Theme
  function initTheme() {
    const saved = localStorage.getItem("morning-news-theme");
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
    localStorage.setItem("morning-news-theme", next);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  // Events
  elBtnPrev.addEventListener("click", prevSlide);
  elBtnNext.addEventListener("click", nextSlide);
  elBtnAutoplay.addEventListener("click", toggleAutoplay);
  elBtnTheme.addEventListener("click", toggleTheme);
  elBtnFullscreen.addEventListener("click", toggleFullscreen);
  elBtnOverview.addEventListener("click", openOverview);
  elBtnCloseOverview.addEventListener("click", closeOverview);
  elOverviewBackdrop.addEventListener("click", closeOverview);

  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.category = btn.getAttribute("data-category");
      state.currentIndex = 0;
      buildSlides();
      renderSlide();
      if (state.isAutoplaying) resetAutoplayCycle();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (!elOverviewModal.hidden) {
      if (e.key === "Escape") closeOverview();
      return;
    }
    if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      nextSlide();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prevSlide();
    } else if (e.key.toLowerCase() === "p") {
      toggleAutoplay();
    } else if (e.key.toLowerCase() === "o") {
      openOverview();
    } else if (e.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  });

  // Touch Swipe
  let touchStartX = 0;
  elSlideContainer.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.changedTouches[0].screenX;
    },
    { passive: true }
  );
  elSlideContainer.addEventListener(
    "touchend",
    (e) => {
      const diff = e.changedTouches[0].screenX - touchStartX;
      if (Math.abs(diff) > 50) {
        if (diff < 0) nextSlide();
        else prevSlide();
      }
    },
    { passive: true }
  );

  // Init
  initTheme();
  elHeaderDate.textContent = state.rawData.date || "--";
  buildSlides();
  renderSlide();
})();

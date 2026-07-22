(function () {
  "use strict";

  const FONT_SCALES = [80, 90, 100, 110, 120, 130, 140];
  const PULL_THRESHOLD = 84;
  const PULL_EDGE_TOLERANCE = 3;
  const params = new URLSearchParams(window.location.search);
  const bookId = params.get("book") || "huayan";
  const volumeId = params.get("volume") || "01";
  const indexUrl = `./data/${bookId}/volume-${volumeId}-index.json`;

  const viewport = document.getElementById("readingViewport");
  const sutraText = document.getElementById("sutraText");
  const tocDrawer = document.getElementById("tocDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const settingsPanel = document.getElementById("settingsPanel");
  const tocButton = document.getElementById("tocButton");
  const settingsButton = document.getElementById("settingsButton");
  const progressLabel = document.getElementById("readerProgress");
  const currentSectionLabel = document.getElementById("currentSectionLabel");
  const footerSectionTitle = document.getElementById("footerSectionTitle");
  const sourcePageLabel = document.getElementById("sourcePageLabel");
  const fontScaleLabel = document.getElementById("fontScaleLabel");
  const pinyinToggle = document.getElementById("pinyinToggle");
  const toast = document.getElementById("readerToast");

  let volumeIndex = null;
  let activeSectionIndex = 0;
  let currentSourcePage = null;
  let currentSourcePageLabel = null;
  let saveTimer = null;
  let toastTimer = null;
  let sectionRequest = 0;
  let sectionLoading = false;
  let pageObserver = null;
  let pullStartX = null;
  let pullStartY = null;
  let pullDirection = null;
  let pullDistance = 0;
  let wheelPullDirection = null;
  let wheelPullDistance = 0;
  let wheelPullTimer = null;

  function readStorage(key, fallback) {
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    if (window.sutraApp) window.sutraApp.writeStorage(key, value);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1800);
  }

  function closeToc() {
    tocDrawer.dataset.open = "false";
    tocDrawer.setAttribute("aria-hidden", "true");
    tocButton.setAttribute("aria-expanded", "false");
    drawerBackdrop.hidden = true;
  }

  function openToc() {
    closeSettings();
    tocDrawer.dataset.open = "true";
    tocDrawer.setAttribute("aria-hidden", "false");
    tocButton.setAttribute("aria-expanded", "true");
    drawerBackdrop.hidden = false;
    tocDrawer.querySelector("button[data-section].active")?.focus();
  }

  function closeSettings() {
    settingsPanel.dataset.open = "false";
    settingsPanel.setAttribute("aria-hidden", "true");
    settingsButton.setAttribute("aria-expanded", "false");
  }

  function openSettings() {
    closeToc();
    settingsPanel.dataset.open = "true";
    settingsPanel.setAttribute("aria-hidden", "false");
    settingsButton.setAttribute("aria-expanded", "true");
  }

  function scrollMetrics() {
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const left = Math.max(0, viewport.scrollLeft);
    return { max, ratio: max ? Math.max(0, Math.min(1, 1 - left / max)) : 0 };
  }

  function setReadingRatio(ratio) {
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = max * (1 - Math.max(0, Math.min(1, ratio || 0)));
  }

  function captureReadingPosition() {
    const metrics = scrollMetrics();
    const page = currentSourcePage === null
      ? null
      : pageElementFor(currentSourcePage);
    if (!page) {
      return {
        ratio: metrics.ratio,
        sourcePage: currentSourcePage,
        sourcePageLabel: currentSourcePageLabel,
        pageOffsetRatio: 0
      };
    }

    const viewportRight = viewport.scrollLeft + viewport.clientWidth;
    const pageRight = page.offsetLeft + page.offsetWidth;
    const maxPageOffsetRatio = Math.max(0, 1 - viewport.clientWidth / Math.max(1, page.offsetWidth));
    const pageOffsetRatio = Math.max(0, Math.min(maxPageOffsetRatio, (pageRight - viewportRight) / Math.max(1, page.offsetWidth)));
    return {
      ratio: metrics.ratio,
      sourcePage: currentSourcePage,
      sourcePageLabel: currentSourcePageLabel,
      pageOffsetRatio
    };
  }

  function pageElementFor(sourcePage) {
    if (sourcePage === null || sourcePage === undefined || sourcePage === "") return null;
    const raw = String(sourcePage);
    return document.getElementById(`page-${raw}`) ||
      (/^\d+$/.test(raw) ? document.getElementById(`page-printed-${raw}`) : null);
  }

  function restoreReadingPosition(position) {
    const page = position?.edge === "end"
      ? [...sutraText.querySelectorAll(".source-page")].at(-1)
      : pageElementFor(position?.sourcePage);
    if (!page) {
      setReadingRatio(position?.edge === "end" ? 1 : Number(position?.ratio) || 0);
      return;
    }

    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const pageRight = page.offsetLeft + page.offsetWidth;
    const maxPageOffsetRatio = Math.max(0, 1 - viewport.clientWidth / Math.max(1, page.offsetWidth));
    const pageOffsetRatio = Math.max(0, Math.min(maxPageOffsetRatio, Number(position?.pageOffsetRatio) || 0));
    viewport.scrollLeft = Math.max(0, Math.min(max, pageRight - page.offsetWidth * pageOffsetRatio - viewport.clientWidth));
    currentSourcePage = page.dataset.sourcePage;
    currentSourcePageLabel = page.dataset.sourcePageLabel;
    sourcePageLabel.textContent = currentSourcePageLabel;
  }

  function getSavedProgress() {
    try {
      const saved = JSON.parse(readStorage("sutra-progress", "null"));
      if (saved && saved.book === bookId && saved.volume === volumeId) return saved;
    } catch (_error) {
      // Ignore malformed progress.
    }
    return null;
  }

  function saveProgress() {
    if (!volumeIndex) return;
    const section = volumeIndex.sections[activeSectionIndex];
    const position = captureReadingPosition();
    const payload = {
      version: 3,
      book: bookId,
      volume: volumeId,
      section: section.id,
      sectionTitle: section.title,
      ratio: Number(position.ratio.toFixed(5)),
      sourcePage: position.sourcePage,
      sourcePageLabel: position.sourcePageLabel,
      pageOffsetRatio: Number(position.pageOffsetRatio.toFixed(5)),
      updatedAt: new Date().toISOString()
    };
    writeStorage("sutra-progress", JSON.stringify(payload));
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveProgress, 180);
  }

  function updateProgress() {
    const percent = Math.round(scrollMetrics().ratio * 100);
    progressLabel.textContent = `${percent}%`;
    scheduleSave();
  }

  function updateSettingsUi() {
    const scale = Number(document.documentElement.dataset.readerFontScale || 100);
    fontScaleLabel.textContent = `${scale}%`;
    const pinyinOn = document.documentElement.dataset.pinyin !== "off";
    pinyinToggle.setAttribute("aria-checked", String(pinyinOn));
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.dataset.selected = String(button.dataset.themeOption === document.documentElement.dataset.theme);
    });
  }

  function setFontScale(nextScale) {
    const currentPosition = captureReadingPosition();
    const scale = FONT_SCALES.includes(nextScale) ? nextScale : 100;
    document.documentElement.dataset.readerFontScale = String(scale);
    writeStorage("sutra-font-scale", String(scale));
    updateSettingsUi();
    window.requestAnimationFrame(() => restoreReadingPosition(currentPosition));
    showToast(`文字大小 ${scale}%`);
  }

  function shiftFontScale(delta) {
    const current = Number(document.documentElement.dataset.readerFontScale || 100);
    const index = Math.max(0, FONT_SCALES.indexOf(current));
    setFontScale(FONT_SCALES[Math.max(0, Math.min(FONT_SCALES.length - 1, index + delta))]);
  }

  function togglePinyin() {
    const next = document.documentElement.dataset.pinyin === "off" ? "on" : "off";
    const currentPosition = captureReadingPosition();
    document.documentElement.dataset.pinyin = next;
    writeStorage("sutra-pinyin", next);
    updateSettingsUi();
    window.requestAnimationFrame(() => restoreReadingPosition(currentPosition));
    showToast(next === "on" ? "已顯示拼音" : "已隱藏拼音");
  }

  function renderToc() {
    const toc = document.getElementById("tocList");
    toc.innerHTML = volumeIndex.sections.map((section, index) => `
      <button type="button" data-section="${section.id}" data-index="${index}">
        <span class="toc-number">${String(index + 1).padStart(2, "0")}</span>
        <span><strong>${section.title}</strong><small>${section.sourcePageLabel}</small></span>
      </button>`).join("");
    toc.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-index]");
      if (!button) return;
      loadSection(Number(button.dataset.index), { ratio: 0 });
      closeToc();
    });
  }

  function updateSectionUi(section) {
    currentSectionLabel.textContent = section.title;
    footerSectionTitle.textContent = section.shortTitle || section.title;
    sourcePageLabel.textContent = section.sourcePageLabel;
    document.getElementById("previousSection").disabled = activeSectionIndex === 0;
    document.getElementById("nextSection").disabled = activeSectionIndex === volumeIndex.sections.length - 1;
    document.querySelectorAll("#tocList button[data-index]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.index) === activeSectionIndex);
      if (Number(button.dataset.index) === activeSectionIndex) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function hasNextSection() {
    return Boolean(volumeIndex && activeSectionIndex < volumeIndex.sections.length - 1);
  }

  function hasPreviousSection() {
    return Boolean(volumeIndex && activeSectionIndex > 0);
  }

  function isAtSectionStart() {
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    return viewport.scrollLeft >= max - PULL_EDGE_TOLERANCE;
  }

  function isAtSectionEnd() {
    return viewport.scrollLeft <= PULL_EDGE_TOLERANCE;
  }

  function updatePullIndicator(direction, distance) {
    pullDistance = Math.max(0, distance);
    const indicators = {
      previous: document.getElementById("sectionReturn"),
      next: document.getElementById("sectionContinuation")
    };

    Object.values(indicators).forEach((indicator) => {
      if (!indicator) return;
      indicator.style.setProperty("--pull-progress", "0");
      indicator.dataset.ready = "false";
      const label = indicator.querySelector("[data-pull-label]");
      if (label) label.textContent = indicator.id === "sectionReturn"
        ? "再拉一下，回到上一節"
        : "再拉一下，進入下一節";
    });

    const indicator = indicators[direction];
    if (!indicator) return;
    const progress = Math.min(1, pullDistance / PULL_THRESHOLD);
    indicator.style.setProperty("--pull-progress", String(progress));
    indicator.dataset.ready = String(progress >= 1);
    const label = indicator.querySelector("[data-pull-label]");
    if (label && progress >= 1) label.textContent = direction === "previous"
      ? "放開回到上一節"
      : "放開進入下一節";
  }

  function resetPullGesture() {
    pullStartX = null;
    pullStartY = null;
    pullDirection = null;
    updatePullIndicator(null, 0);
  }

  function resetWheelPull() {
    window.clearTimeout(wheelPullTimer);
    wheelPullDirection = null;
    wheelPullDistance = 0;
    updatePullIndicator(null, 0);
  }

  function goToPreviousSection() {
    if (!hasPreviousSection() || sectionLoading) return;
    saveProgress();
    showToast("正在展開上一節末頁");
    loadSection(activeSectionIndex - 1, { edge: "end" });
  }

  function goToNextSection() {
    if (!hasNextSection() || sectionLoading) return;
    saveProgress();
    showToast("正在展開下一節");
    loadSection(activeSectionIndex + 1, { ratio: 0 });
  }

  function handleTouchStart(event) {
    if (sectionLoading || event.touches.length !== 1) return;
    pullStartX = event.touches[0].clientX;
    pullStartY = event.touches[0].clientY;
    pullDirection = hasPreviousSection() && isAtSectionStart()
      ? "previous"
      : hasNextSection() && isAtSectionEnd()
        ? "next"
        : null;
    updatePullIndicator(pullDirection, 0);
  }

  function handleTouchMove(event) {
    if (sectionLoading || event.touches.length !== 1 || pullStartX === null) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - pullStartX;
    const deltaY = touch.clientY - pullStartY;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

    if (pullDirection === null) {
      if (hasPreviousSection() && isAtSectionStart() && deltaX < 0) pullDirection = "previous";
      else if (hasNextSection() && isAtSectionEnd() && deltaX > 0) pullDirection = "next";
      else return;
      pullStartX = touch.clientX;
      pullStartY = touch.clientY;
      updatePullIndicator(pullDirection, 0);
      return;
    }

    const stillAtEdge = pullDirection === "previous" ? isAtSectionStart() : isAtSectionEnd();
    const distance = pullDirection === "previous" ? -deltaX : deltaX;
    if (!stillAtEdge || distance <= 0) {
      updatePullIndicator(pullDirection, 0);
      if (!stillAtEdge) pullDirection = null;
      return;
    }

    event.preventDefault();
    updatePullIndicator(pullDirection, distance);
  }

  function handleTouchEnd() {
    const direction = pullDirection;
    const shouldContinue = pullDistance >= PULL_THRESHOLD;
    resetPullGesture();
    if (!shouldContinue) return;
    if (direction === "previous") goToPreviousSection();
    if (direction === "next") goToNextSection();
  }

  function handleWheel(event) {
    if (sectionLoading || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const direction = hasPreviousSection() && isAtSectionStart() && event.deltaX > 0
      ? "previous"
      : hasNextSection() && isAtSectionEnd() && event.deltaX < 0
        ? "next"
        : null;
    if (!direction) {
      resetWheelPull();
      return;
    }

    event.preventDefault();
    if (wheelPullDirection !== direction) {
      wheelPullDirection = direction;
      wheelPullDistance = 0;
    }
    wheelPullDistance += Math.abs(event.deltaX);
    updatePullIndicator(direction, wheelPullDistance);
    window.clearTimeout(wheelPullTimer);

    if (wheelPullDistance >= PULL_THRESHOLD) {
      resetWheelPull();
      if (direction === "previous") goToPreviousSection();
      else goToNextSection();
      return;
    }
    wheelPullTimer = window.setTimeout(resetWheelPull, 220);
  }

  function observePages() {
    pageObserver?.disconnect();
    const pages = [...sutraText.querySelectorAll(".source-page")];
    pageObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      currentSourcePage = visible.target.dataset.sourcePage;
      currentSourcePageLabel = visible.target.dataset.sourcePageLabel;
      sourcePageLabel.textContent = currentSourcePageLabel;
      scheduleSave();
    }, { root: viewport, threshold: [0.25, 0.5, 0.75] });
    pages.forEach((page) => pageObserver.observe(page));
  }

  async function loadSection(index, restorePosition = { ratio: 0 }) {
    if (!volumeIndex || index < 0 || index >= volumeIndex.sections.length) return;
    const requestId = ++sectionRequest;
    sectionLoading = true;
    activeSectionIndex = index;
    const section = volumeIndex.sections[index];
    currentSourcePage = null;
    currentSourcePageLabel = null;
    resetPullGesture();
    updateSectionUi(section);
    sutraText.innerHTML = '<div class="reader-loading"><span class="loading-seal" aria-hidden="true">經</span><p>正在展卷…</p></div>';

    try {
      const response = await fetch(`./${section.content}`);
      if (!response.ok) throw new Error(`section ${response.status}`);
      const data = await response.json();
      if (requestId !== sectionRequest) return;

      const pages = data.pages.map((page) => page.facsimile
        ? `<section class="source-page facsimile-page" id="page-${page.pageKey}" data-source-page="${page.pageKey}" data-source-page-label="${page.pageLabel}" aria-label="${page.pageLabel}圖像">
            <span class="page-folio" aria-hidden="true">${page.folioLabel}</span>
            <img src="./${page.facsimile}" alt="${page.pageLabel}原貌" loading="lazy" decoding="async">
          </section>`
        : `<section class="source-page" id="page-${page.pageKey}" data-source-page="${page.pageKey}" data-source-page-label="${page.pageLabel}" aria-label="${page.pageLabel}">
            <span class="page-folio" aria-hidden="true">${page.folioLabel}</span>
            <div class="page-text">${page.html}</div>
          </section>`).join("");

      const previousSection = volumeIndex.sections[index - 1];
      const nextSection = volumeIndex.sections[index + 1];
      const returnHint = previousSection
        ? `<div class="section-return" id="sectionReturn" aria-label="本節開頭，上一節為${previousSection.title}" data-ready="false">
            <span class="return-arrow" aria-hidden="true">→</span>
            <div class="return-meter" aria-hidden="true"><span></span></div>
            <p data-pull-label>再拉一下，回到上一節</p>
            <small>上一節 · ${previousSection.shortTitle || previousSection.title}</small>
          </div>`
        : "";
      const continuation = nextSection
        ? `<section class="section-continuation" id="sectionContinuation" aria-label="本節結束，下一節為${nextSection.title}" data-ready="false">
            <span class="continuation-arrow" aria-hidden="true">←</span>
            <div class="continuation-meter" aria-hidden="true"><span></span></div>
            <p data-pull-label>再拉一下，進入下一節</p>
            <h2>下一節 · ${nextSection.shortTitle || nextSection.title}</h2>
            <button type="button" id="continueSection">直接進入下一節</button>
            <small>到達末尾後，順勢繼續拉動</small>
          </section>`
        : `<section class="section-continuation is-final" id="sectionContinuation" aria-label="第一冊閱讀完畢">
            <span class="continuation-seal" aria-hidden="true">圓</span>
            <p>功德圓滿</p>
            <h2>第一冊讀畢</h2>
            <a href="./index.html">返回藏經閣</a>
          </section>`;

      sutraText.innerHTML = `
        <header class="section-title-page">
          ${returnHint}
          <p>大方廣佛華嚴經 · 第一冊</p>
          <h1>${section.title}</h1>
          <span>${volumeIndex.translator}</span>
          <small>拼音依原 PDF 字形還原 · ${section.sourcePageLabel}</small>
        </header>${pages}${continuation}`;

      document.getElementById("continueSection")?.addEventListener("click", goToNextSection);

      const nextParams = new URLSearchParams({ book: bookId, volume: volumeId, section: section.id, resume: "1" });
      window.history.replaceState(null, "", `${window.location.pathname}?${nextParams.toString()}`);
      document.title = `${section.shortTitle || section.title} · 華嚴經第一冊`;
      sectionLoading = false;
      window.requestAnimationFrame(() => {
        restoreReadingPosition(restorePosition);
        updateProgress();
        observePages();
        viewport.focus({ preventScroll: true });
      });
    } catch (_error) {
      if (requestId !== sectionRequest) return;
      sectionLoading = false;
      sutraText.innerHTML = `
        <div class="reader-error">
          <span class="loading-seal" aria-hidden="true">止</span>
          <h2>這一卷暫時無法展開</h2>
          <p>請檢查網路，或先返回已開啟過的卷次。</p>
          <button class="primary-button" type="button" id="retrySection">重新載入</button>
        </div>`;
      document.getElementById("retrySection")?.addEventListener("click", () => loadSection(index, restorePosition));
    }
  }

  async function initialize() {
    updateSettingsUi();
    try {
      const response = await fetch(indexUrl);
      if (!response.ok) throw new Error(`index ${response.status}`);
      volumeIndex = await response.json();
      document.getElementById("readerTitle").textContent = `${volumeIndex.bookTitle} · ${volumeIndex.volumeLabel}`;
      renderToc();

      const saved = getSavedProgress();
      const requestedSection = params.get("section");
      const requestedPage = params.get("page");
      const resumeRequested = params.get("resume") === "1";
      const sectionId = requestedSection || saved?.section || volumeIndex.sections[0].id;
      activeSectionIndex = Math.max(0, volumeIndex.sections.findIndex((section) => section.id === sectionId));
      const shouldRestoreSaved = saved?.section === sectionId && (!requestedSection || resumeRequested);
      const restorePosition = shouldRestoreSaved
        ? saved
        : {
            ratio: 0,
            sourcePage: requestedPage || null,
            sourcePageLabel: null,
            pageOffsetRatio: 0
          };
      await loadSection(activeSectionIndex, restorePosition);
    } catch (_error) {
      sutraText.innerHTML = '<div class="reader-error"><span class="loading-seal" aria-hidden="true">止</span><h2>第一冊目錄暫時無法載入</h2><p>請回到藏書閣後再試一次。</p><a class="primary-button" href="./index.html">返回藏書閣</a></div>';
    }
  }

  tocButton.addEventListener("click", () => tocDrawer.dataset.open === "true" ? closeToc() : openToc());
  document.getElementById("sectionJump").addEventListener("click", openToc);
  document.getElementById("closeToc").addEventListener("click", closeToc);
  drawerBackdrop.addEventListener("click", closeToc);
  settingsButton.addEventListener("click", () => settingsPanel.dataset.open === "true" ? closeSettings() : openSettings());
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("fontDecrease").addEventListener("click", () => shiftFontScale(-1));
  document.getElementById("fontIncrease").addEventListener("click", () => shiftFontScale(1));
  document.getElementById("fontReset").addEventListener("click", () => setFontScale(100));
  pinyinToggle.addEventListener("click", togglePinyin);
  document.getElementById("previousSection").addEventListener("click", () => loadSection(activeSectionIndex - 1, { ratio: 0 }));
  document.getElementById("nextSection").addEventListener("click", goToNextSection);
  document.addEventListener("sutra:theme", updateSettingsUi);

  viewport.addEventListener("scroll", updateProgress, { passive: true });
  viewport.addEventListener("touchstart", handleTouchStart, { passive: true });
  viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
  viewport.addEventListener("touchend", handleTouchEnd, { passive: true });
  viewport.addEventListener("touchcancel", resetPullGesture, { passive: true });
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("pagehide", saveProgress);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveProgress(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeToc(); closeSettings(); }
    if (event.target.closest("button, a, input")) return;
    if (event.key === "ArrowLeft" || event.key === "PageDown") viewport.scrollBy({ left: -viewport.clientWidth * 0.82, behavior: "smooth" });
    if (event.key === "ArrowRight" || event.key === "PageUp") viewport.scrollBy({ left: viewport.clientWidth * 0.82, behavior: "smooth" });
  });

  initialize();
})();

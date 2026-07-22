(function () {
  "use strict";

  const FONT_SCALES = [80, 90, 100, 110, 120, 130, 140];
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
  let saveTimer = null;
  let toastTimer = null;
  let sectionRequest = 0;

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
    const metrics = scrollMetrics();
    const payload = {
      book: bookId,
      volume: volumeId,
      section: section.id,
      sectionTitle: section.title,
      ratio: Number(metrics.ratio.toFixed(5)),
      sourcePage: currentSourcePage,
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
    const currentRatio = scrollMetrics().ratio;
    const scale = FONT_SCALES.includes(nextScale) ? nextScale : 100;
    document.documentElement.dataset.readerFontScale = String(scale);
    writeStorage("sutra-font-scale", String(scale));
    updateSettingsUi();
    window.requestAnimationFrame(() => setReadingRatio(currentRatio));
    showToast(`文字大小 ${scale}%`);
  }

  function shiftFontScale(delta) {
    const current = Number(document.documentElement.dataset.readerFontScale || 100);
    const index = Math.max(0, FONT_SCALES.indexOf(current));
    setFontScale(FONT_SCALES[Math.max(0, Math.min(FONT_SCALES.length - 1, index + delta))]);
  }

  function togglePinyin() {
    const next = document.documentElement.dataset.pinyin === "off" ? "on" : "off";
    const ratio = scrollMetrics().ratio;
    document.documentElement.dataset.pinyin = next;
    writeStorage("sutra-pinyin", next);
    updateSettingsUi();
    window.requestAnimationFrame(() => setReadingRatio(ratio));
    showToast(next === "on" ? "已顯示拼音" : "已隱藏拼音");
  }

  function renderToc() {
    const toc = document.getElementById("tocList");
    toc.innerHTML = volumeIndex.sections.map((section, index) => `
      <button type="button" data-section="${section.id}" data-index="${index}">
        <span class="toc-number">${String(index + 1).padStart(2, "0")}</span>
        <span><strong>${section.title}</strong><small>原書 ${section.sourcePageLabel}</small></span>
      </button>`).join("");
    toc.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-index]");
      if (!button) return;
      loadSection(Number(button.dataset.index), 0);
      closeToc();
    });
  }

  function updateSectionUi(section) {
    currentSectionLabel.textContent = section.title;
    footerSectionTitle.textContent = section.shortTitle || section.title;
    sourcePageLabel.textContent = `原書 ${section.sourcePageLabel}`;
    document.getElementById("previousSection").disabled = activeSectionIndex === 0;
    document.getElementById("nextSection").disabled = activeSectionIndex === volumeIndex.sections.length - 1;
    document.querySelectorAll("#tocList button[data-index]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.index) === activeSectionIndex);
      if (Number(button.dataset.index) === activeSectionIndex) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function observePages() {
    const pages = [...sutraText.querySelectorAll(".source-page")];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      currentSourcePage = Number(visible.target.dataset.sourcePage);
      sourcePageLabel.textContent = `原書第 ${currentSourcePage} 頁`;
    }, { root: viewport, threshold: [0.25, 0.5, 0.75] });
    pages.forEach((page) => observer.observe(page));
  }

  async function loadSection(index, ratio) {
    if (!volumeIndex || index < 0 || index >= volumeIndex.sections.length) return;
    const requestId = ++sectionRequest;
    activeSectionIndex = index;
    const section = volumeIndex.sections[index];
    updateSectionUi(section);
    sutraText.innerHTML = '<div class="reader-loading"><span class="loading-seal" aria-hidden="true">經</span><p>正在展卷…</p></div>';

    try {
      const response = await fetch(`./${section.content}`);
      if (!response.ok) throw new Error(`section ${response.status}`);
      const data = await response.json();
      if (requestId !== sectionRequest) return;

      const pages = data.pages.map((page) => page.facsimile
        ? `<section class="source-page facsimile-page" id="page-${page.printedPage}" data-source-page="${page.printedPage}" aria-label="原書第 ${page.printedPage} 頁圖像">
            <span class="page-folio" aria-hidden="true">${page.printedPage}</span>
            <img src="./${page.facsimile}" alt="原書第 ${page.printedPage} 頁特殊字形或附錄原貌" loading="lazy" decoding="async">
          </section>`
        : `<section class="source-page" id="page-${page.printedPage}" data-source-page="${page.printedPage}" aria-label="原書第 ${page.printedPage} 頁">
            <span class="page-folio" aria-hidden="true">${page.printedPage}</span>
            <div class="page-text">${page.html}</div>
          </section>`).join("");

      sutraText.innerHTML = `
        <header class="section-title-page">
          <p>大方廣佛華嚴經 · 第一冊</p>
          <h1>${section.title}</h1>
          <span>${volumeIndex.translator}</span>
          <small>拼音為自動校注 · 原書 ${section.sourcePageLabel}</small>
        </header>${pages}`;

      const nextParams = new URLSearchParams({ book: bookId, volume: volumeId, section: section.id });
      window.history.replaceState(null, "", `${window.location.pathname}?${nextParams.toString()}`);
      document.title = `${section.shortTitle || section.title} · 華嚴經第一冊`;
      currentSourcePage = data.pages[0]?.printedPage || null;
      window.requestAnimationFrame(() => {
        setReadingRatio(ratio || 0);
        updateProgress();
        observePages();
        viewport.focus({ preventScroll: true });
      });
    } catch (_error) {
      sutraText.innerHTML = `
        <div class="reader-error">
          <span class="loading-seal" aria-hidden="true">止</span>
          <h2>這一卷暫時無法展開</h2>
          <p>請檢查網路，或先返回已開啟過的卷次。</p>
          <button class="primary-button" type="button" id="retrySection">重新載入</button>
        </div>`;
      document.getElementById("retrySection")?.addEventListener("click", () => loadSection(index, ratio));
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
      const sectionId = requestedSection || saved?.section || volumeIndex.sections[0].id;
      activeSectionIndex = Math.max(0, volumeIndex.sections.findIndex((section) => section.id === sectionId));
      const restoreRatio = !requestedSection && saved?.section === sectionId ? saved.ratio : 0;
      await loadSection(activeSectionIndex, restoreRatio);
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
  document.getElementById("previousSection").addEventListener("click", () => loadSection(activeSectionIndex - 1, 0));
  document.getElementById("nextSection").addEventListener("click", () => loadSection(activeSectionIndex + 1, 0));
  document.addEventListener("sutra:theme", updateSettingsUi);

  viewport.addEventListener("scroll", updateProgress, { passive: true });
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

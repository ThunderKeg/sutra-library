(function () {
  "use strict";

  const THEME_ORDER = ["paper", "eye", "night"];
  const THEME_COLORS = { paper: "#263a31", eye: "#2f4638", night: "#17211c" };
  let installPrompt = null;

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // Preferences are optional when storage is unavailable.
    }
  }

  function updateThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.paper);
  }

  function setTheme(theme) {
    const nextTheme = THEME_ORDER.includes(theme) ? theme : "paper";
    document.documentElement.dataset.theme = nextTheme;
    writeStorage("sutra-theme", nextTheme);
    updateThemeColor(nextTheme);
    document.dispatchEvent(new CustomEvent("sutra:theme", { detail: nextTheme }));
  }

  function cycleTheme() {
    const current = document.documentElement.dataset.theme || "paper";
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    setTheme(next);
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function showInstallHelp() {
    const dialog = document.getElementById("installDialog");
    const instructions = document.getElementById("installInstructions");
    if (!dialog || !instructions) return;

    instructions.innerHTML = isIos()
      ? "<p>在 Safari 底部點按「分享」，再選「加入主畫面」。第一次連線開啟後，第一冊即可離線閱讀。</p>"
      : "<p>打開瀏覽器選單，選擇「安裝應用程式」或「加到主畫面」。第一次連線開啟後，第一冊即可離線閱讀。</p>";
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      document.querySelectorAll("[data-install]").forEach((button) => { button.hidden = true; });
      return;
    }
    showInstallHelp();
  }

  function configureInstallButtons() {
    const buttons = document.querySelectorAll("[data-install]");
    if (isStandalone()) return;
    if (isIos()) buttons.forEach((button) => { button.hidden = false; });
    buttons.forEach((button) => button.addEventListener("click", installApp));

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      installPrompt = event;
      buttons.forEach((button) => { button.hidden = false; });
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function volumeMarkup(volume) {
    if (volume.status === "ready") {
      return `<a class="volume-chip volume-ready" href="${escapeHtml(volume.href)}"><span>${escapeHtml(volume.label)}</span><small>可閱讀</small></a>`;
    }
    return `<span class="volume-chip" title="原始 PDF 已下載，HTML 轉換待完成"><span>${escapeHtml(volume.label)}</span><small>待整理</small></span>`;
  }

  function bookMarkup(book) {
    return `
      <article class="book-card">
        <div class="book-spine" aria-hidden="true"><span>${escapeHtml(book.shortTitle)}</span></div>
        <div class="book-details">
          <p class="eyebrow">${escapeHtml(book.edition)}</p>
          <h3>${escapeHtml(book.title)}</h3>
          <p class="translator">${escapeHtml(book.translator)}</p>
          <p>${escapeHtml(book.description)}</p>
          <div class="volume-list" aria-label="冊次">${book.volumes.map(volumeMarkup).join("")}</div>
          <div class="book-actions">
            <a class="primary-button" href="${escapeHtml(book.volumes[0].href)}">展卷讀誦</a>
            <a class="text-link" href="${escapeHtml(book.sourceUrl)}" target="_blank" rel="noreferrer">查看原始資料</a>
          </div>
        </div>
      </article>`;
  }

  async function renderLibrary() {
    const grid = document.getElementById("libraryGrid");
    if (!grid) return;
    try {
      const response = await fetch("./data/library.json");
      if (!response.ok) throw new Error(`library ${response.status}`);
      const library = await response.json();
      grid.innerHTML = library.books.map(bookMarkup).join("");
    } catch (_error) {
      grid.innerHTML = '<article class="book-card"><div class="book-details"><h3>大方廣佛華嚴經</h3><p>藏書目錄暫時無法載入。</p><a class="primary-button" href="./reader.html?book=huayan&amp;volume=01">直接閱讀第一冊</a></div></article>';
    }
  }

  function showResumeCard() {
    const card = document.getElementById("resumeCard");
    const title = document.getElementById("resumeTitle");
    if (!card || !title) return;
    try {
      const progress = JSON.parse(window.localStorage.getItem("sutra-progress") || "null");
      if (!progress || progress.book !== "huayan" || progress.volume !== "01") return;
      const params = new URLSearchParams({
        book: "huayan",
        volume: "01",
        section: progress.section,
        resume: "1",
      });
      const hasSourcePage = progress.sourcePage !== null
        && progress.sourcePage !== undefined
        && progress.sourcePage !== "";
      if (hasSourcePage) {
        params.set("page", String(progress.sourcePage));
      }
      card.href = `./reader.html?${params.toString()}`;
      const pageLabel = hasSourcePage
        ? ` · ${progress.sourcePageLabel || (/^\d+$/.test(String(progress.sourcePage)) ? `原書第 ${progress.sourcePage} 頁` : progress.sourcePage)}`
        : "";
      title.textContent = `${progress.sectionTitle || "華嚴經第一冊"}${pageLabel}`;
      card.hidden = false;
    } catch (_error) {
      // Ignore malformed or unavailable storage.
    }
  }

  document.querySelectorAll("[data-theme-cycle]").forEach((button) => button.addEventListener("click", cycleTheme));
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeOption));
  });

  configureInstallButtons();
  renderLibrary();
  showResumeCard();
  updateThemeColor(document.documentElement.dataset.theme || "paper");

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  window.sutraApp = { setTheme, installApp, writeStorage };
})();

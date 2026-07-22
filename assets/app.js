(function () {
  "use strict";

  const THEME_ORDER = ["paper", "eye", "night"];
  const THEME_COLORS = { paper: "#263a31", eye: "#2f4638", night: "#17211c" };
  const APP_VERSION = "20260722-manual-offline-v1";
  const UPDATE_INTERVAL_MS = 15 * 60 * 1000;
  let installPrompt = null;
  let serviceWorkerPromise = null;
  let serviceWorkerUpdatesConfigured = false;

  document.documentElement.dataset.appVersion = APP_VERSION;

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
      ? "<p>在 Safari 底部點按「分享」，再選「加入主畫面」。安裝後按章節載入；如需完整離線閱讀，請主動下載整冊。</p>"
      : "<p>打開瀏覽器選單，選擇「安裝應用程式」或「加到主畫面」。安裝後按章節載入；如需完整離線閱讀，請主動下載整冊。</p>";
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
    return `<span class="volume-chip" title="此冊尚待整理"><span>${escapeHtml(volume.label)}</span><small>待整理</small></span>`;
  }

  function bookMarkup(book) {
    const readyVolume = book.volumes.find((volume) => volume.status === "ready");
    const offlineDownload = readyVolume
      ? `<div class="offline-download">
          <button class="text-button" type="button" data-offline-download data-index-url="./data/${escapeHtml(book.id)}/volume-${escapeHtml(readyVolume.id)}-index.json">下載整冊離線閱讀</button>
          <small data-offline-status aria-live="polite">首次只載入當前章節；點按後才下載整冊。</small>
        </div>`
      : "";
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
            <a class="text-link" href="${escapeHtml(book.sourceUrl)}" target="_blank" rel="noreferrer">文本來源 · ${escapeHtml(book.sourceName)}</a>
          </div>
          ${offlineDownload}
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
      title.textContent = progress.sectionTitle || "華嚴經第一冊";
      card.hidden = false;
    } catch (_error) {
      // Ignore malformed or unavailable storage.
    }
  }

  function ensureServiceWorker() {
    if (!serviceWorkerPromise) {
      serviceWorkerPromise = navigator.serviceWorker.register("./sw.js", {
        scope: "./",
        updateViaCache: "none"
      }).catch((error) => {
        serviceWorkerPromise = null;
        throw error;
      });
    }
    return serviceWorkerPromise;
  }

  function updateOfflineDownloadUi(indexUrl, state) {
    document.querySelectorAll("[data-offline-download]").forEach((button) => {
      if (button.dataset.indexUrl !== indexUrl) return;
      const status = button.closest(".offline-download")?.querySelector("[data-offline-status]");
      button.disabled = state.kind === "downloading";
      if (state.kind === "downloading") {
        button.textContent = state.total ? `正在下載 ${state.completed}/${state.total}` : "正在準備下載…";
        if (status) status.textContent = "下載期間可以繼續閱讀，請保持網路連線。";
      } else if (state.kind === "complete") {
        button.textContent = "整冊已可離線閱讀";
        if (status) status.textContent = `已保存 ${state.total} 個經文與影印資源。`;
      } else if (state.kind === "error") {
        button.textContent = "重試下載整冊";
        if (status) status.textContent = state.message || "下載未完成；已保存的部分不會重複下載。";
      }
    });
  }

  async function downloadBookForOffline(indexUrl) {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      throw new Error("此瀏覽器目前不支援離線下載。");
    }
    const registration = await ensureServiceWorker();
    const readyRegistration = await navigator.serviceWorker.ready;
    const worker = readyRegistration.active || registration.active;
    if (!worker) throw new Error("離線服務尚未準備好，請稍後再試。");

    updateOfflineDownloadUi(indexUrl, { kind: "downloading", completed: 0, total: 0 });
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "CACHE_BOOK_PROGRESS") {
          updateOfflineDownloadUi(indexUrl, {
            kind: "downloading",
            completed: message.completed || 0,
            total: message.total || 0
          });
        }
        if (message.type === "CACHE_BOOK_COMPLETE") {
          channel.port1.close();
          updateOfflineDownloadUi(indexUrl, { kind: "complete", total: message.total || 0 });
          resolve(message);
        }
        if (message.type === "CACHE_BOOK_ERROR") {
          channel.port1.close();
          reject(new Error(message.message || "下載未完成；請檢查網路後重試。"));
        }
      };
      worker.postMessage({ type: "CACHE_BOOK", indexUrl }, [channel.port2]);
    });
  }

  async function handleOfflineDownload(button) {
    const indexUrl = button.dataset.indexUrl;
    if (!indexUrl || button.disabled) return;
    try {
      await downloadBookForOffline(indexUrl);
    } catch (error) {
      updateOfflineDownloadUi(indexUrl, { kind: "error", message: error.message });
    }
  }

  async function registerServiceWorker() {
    try {
      const registration = await ensureServiceWorker();
      if (serviceWorkerUpdatesConfigured) return;
      serviceWorkerUpdatesConfigured = true;
      let updateInFlight = false;
      const checkForUpdate = async () => {
        if (updateInFlight) return;
        updateInFlight = true;
        try {
          await registration.update();
        } catch (_error) {
          // Offline reading remains available; retry on the next foreground check.
        } finally {
          updateInFlight = false;
        }
      };

      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkForUpdate();
      });
      window.addEventListener("focus", checkForUpdate);
      window.addEventListener("online", checkForUpdate);
      window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
      checkForUpdate();
    } catch (_error) {
      // The site remains usable when service workers are unavailable.
    }
  }

  document.querySelectorAll("[data-theme-cycle]").forEach((button) => button.addEventListener("click", cycleTheme));
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.themeOption));
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-offline-download]");
    if (button) handleOfflineDownload(button);
  });

  configureInstallButtons();
  renderLibrary();
  showResumeCard();
  updateThemeColor(document.documentElement.dataset.theme || "paper");

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", registerServiceWorker);
  }

  window.sutraApp = { setTheme, installApp, writeStorage, downloadBookForOffline };
})();

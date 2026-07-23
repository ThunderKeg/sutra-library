(function () {
  "use strict";

  const FONT_SCALES = [80, 90, 100, 110, 120, 130, 140];
  const PULL_THRESHOLD = 84;
  const PULL_EDGE_TOLERANCE = 3;
  const LEGACY_AUDIO_PROGRESS_KEY = "sutra-audio-progress-v1";
  const AUDIO_ALIGNMENT_URL = "./data/huayan/volume-01-audio-alignment.json";
  const FIRST_VOLUME_AUDIO = Object.freeze({
    "juan-01": { key: "huayan-juan-01", title: "第一卷", url: "https://wz.yyxcfg.com/a/a/4/1012.m4a" },
    "juan-02": { key: "huayan-juan-02", title: "第二卷", url: "https://wz.yyxcfg.com/a/a/4/1013.m4a" },
    "juan-03": { key: "huayan-juan-03", title: "第三卷", url: "https://wz.yyxcfg.com/a/a/4/1014.m4a" },
    "juan-04": { key: "huayan-juan-04", title: "第四卷", url: "https://wz.yyxcfg.com/a/a/4/1015.m4a" },
    "juan-05": { key: "huayan-juan-05", title: "第五卷", url: "https://wz.yyxcfg.com/a/a/4/1016.m4a" },
    "juan-06": { key: "huayan-juan-06", title: "第六卷", url: "https://wz.yyxcfg.com/a/a/4/1017.m4a" },
    "juan-07-puxian": { key: "huayan-juan-07", title: "第七卷", url: "https://wz.yyxcfg.com/a/a/4/1018.m4a" },
    "juan-07-shijie": { key: "huayan-juan-07", title: "第七卷", url: "https://wz.yyxcfg.com/a/a/4/1018.m4a" },
    "juan-08": { key: "huayan-juan-08", title: "第八卷", url: "https://wz.yyxcfg.com/a/a/4/1019.m4a" },
    "juan-09": { key: "huayan-juan-09", title: "第九卷", url: "https://wz.yyxcfg.com/a/a/4/1020.m4a" },
    "juan-10": { key: "huayan-juan-10", title: "第十卷", url: "https://wz.yyxcfg.com/a/a/4/1021.m4a" }
  });
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
  const audioButton = document.getElementById("audioButton");
  const readerAudio = document.getElementById("readerAudio");
  const audioFollowPrompt = document.getElementById("audioFollowPrompt");
  const audioPromptReturnButton = document.getElementById("audioPromptReturnButton");
  const audioReplayHereButton = document.getElementById("audioReplayHereButton");
  const progressLabel = document.getElementById("readerProgress");
  const currentSectionLabel = document.getElementById("currentSectionLabel");
  const footerSectionTitle = document.getElementById("footerSectionTitle");
  const sourcePageLabel = document.getElementById("sourcePageLabel");
  const fontScaleLabel = document.getElementById("fontScaleLabel");
  const pinyinToggle = document.getElementById("pinyinToggle");
  const toast = document.getElementById("readerToast");
  const offlineDownloadButton = document.querySelector("[data-offline-download]");
  if (offlineDownloadButton) offlineDownloadButton.dataset.indexUrl = indexUrl;

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
  let currentAudioTrack = null;
  let audioAlignment = null;
  let audioAlignmentPromise = null;
  let audioFollowEnabled = true;
  let audioFollowDetached = false;
  let audioStartRequest = 0;
  let audioFollowRequest = 0;
  let audioFollowScrollTarget = null;
  let audioFollowVirtualScroll = null;
  let audioFollowAnimationFrame = null;
  let audioPlaybackFollowFrame = null;
  let audioProgrammaticScroll = false;
  let audioProgrammaticScrollTimer = null;
  let manualScrollIntent = false;
  let manualScrollIntentTimer = null;
  let manualScrollActive = false;
  let manualScrollStartedWhileFollowing = false;
  let manualScrollTimer = null;

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

  function discardLegacyAudioProgress() {
    try {
      window.localStorage.removeItem(LEGACY_AUDIO_PROGRESS_KEY);
    } catch (_error) {
      // Storage can be unavailable in private or restricted browsing modes.
    }
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

  function ensureAudioSource() {
    if (!currentAudioTrack || readerAudio.getAttribute("src") === currentAudioTrack.url) return;
    readerAudio.src = currentAudioTrack.url;
    readerAudio.load();
  }

  function prepareAudioPlayback() {
    if (!currentAudioTrack || !readerAudio.paused) return;
    ensureAudioSource();
    ensureAudioAlignment();
  }

  async function startAudioFromReadingPosition() {
    const track = currentAudioTrack;
    const request = ++audioStartRequest;
    prepareAudioPlayback();
    audioButton.disabled = true;
    audioButton.dataset.loading = "true";
    audioButton.textContent = "…";
    audioButton.setAttribute("aria-label", `正在連接${track.title}音頻`);

    let playbackError = null;
    const playAttempt = readerAudio.play().catch((error) => { playbackError = error; });
    const alignment = audioAlignment || await ensureAudioAlignment();
    if (request !== audioStartRequest || currentAudioTrack?.key !== track.key) return;
    if (!alignment || !seekAudioToVisibleText()) {
      readerAudio.pause();
      showToast("目前頁面沒有可對應的讀誦位置");
      audioButton.disabled = false;
      audioButton.dataset.loading = "false";
      audioButton.textContent = "聽";
      audioButton.setAttribute("aria-label", "從目前閱讀位置開始聽");
      return;
    }
    setAudioFollowDetached(false);
    try {
      await playAttempt;
      if (playbackError) throw playbackError;
    } catch (_error) {
      showToast("音頻暫時無法播放，請檢查網路後重試");
    } finally {
      audioButton.disabled = false;
      audioButton.dataset.loading = "false";
      if (readerAudio.paused) {
        audioButton.textContent = "聽";
        audioButton.setAttribute("aria-label", "從目前閱讀位置開始聽");
      } else {
        audioButton.textContent = "停";
        audioButton.setAttribute("aria-label", `暫停${track.title}`);
      }
    }
  }

  function toggleAudioPlayback() {
    if (!currentAudioTrack) {
      showToast("本節沒有對應的讀誦音頻");
      return;
    }
    if (!readerAudio.paused) {
      readerAudio.pause();
      return;
    }
    startAudioFromReadingPosition();
  }

  function getAudioTrack(section) {
    if (bookId !== "huayan" || volumeId !== "01") return null;
    return FIRST_VOLUME_AUDIO[section.id] || null;
  }

  async function ensureAudioAlignment() {
    if (audioAlignment || bookId !== "huayan" || volumeId !== "01") return audioAlignment;
    if (audioAlignmentPromise) return audioAlignmentPromise;
    audioAlignmentPromise = fetch(AUDIO_ALIGNMENT_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`alignment ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        payload.pagesByTrack = new Map();
        payload.pagesByKey = new Map();
        payload.pages.forEach((page) => {
          if (!payload.pagesByTrack.has(page.track)) payload.pagesByTrack.set(page.track, []);
          payload.pagesByTrack.get(page.track).push(page);
          payload.pagesByKey.set(page.pageKey, page);
        });
        audioAlignment = payload;
        return payload;
      })
      .catch(() => {
        audioAlignmentPromise = null;
        if (currentAudioTrack) showToast("文字與音頻對應暫時無法載入");
        return null;
      });
    return audioAlignmentPromise;
  }

  function hideAudioFollowPrompt() {
    audioFollowPrompt.hidden = true;
  }

  function setAudioFollowDetached(detached, { showPrompt = false } = {}) {
    audioFollowDetached = Boolean(detached && currentAudioTrack && !readerAudio.paused);
    audioFollowEnabled = !audioFollowDetached;
    audioFollowPrompt.hidden = !(audioFollowDetached && showPrompt && !readerAudio.paused);
  }

  function alignmentPageAtTime(currentTime) {
    const trackNumber = currentAudioTrack?.url.match(/\/(\d+)\.m4a$/)?.[1];
    const pages = audioAlignment?.pagesByTrack?.get(trackNumber) || [];
    const spokenPages = pages.filter((page) => page.spoken && page.end > page.start);
    if (!spokenPages.length) return null;
    let activePage = spokenPages[0];
    for (const page of spokenPages) {
      if (currentTime < page.start) break;
      activePage = page;
      if (currentTime <= page.end) break;
    }
    return activePage;
  }

  function finishAudioProgrammaticScroll() {
    window.clearTimeout(audioProgrammaticScrollTimer);
    audioProgrammaticScrollTimer = window.setTimeout(() => { audioProgrammaticScroll = false; }, 220);
  }

  function cancelAudioFollowScroll() {
    if (audioFollowAnimationFrame !== null) window.cancelAnimationFrame(audioFollowAnimationFrame);
    audioFollowAnimationFrame = null;
    audioFollowScrollTarget = null;
    audioFollowVirtualScroll = null;
    window.clearTimeout(audioProgrammaticScrollTimer);
    audioProgrammaticScroll = false;
  }

  function animateAudioFollowScroll() {
    if (audioFollowScrollTarget === null || !audioFollowEnabled || manualScrollIntent || manualScrollActive) {
      audioFollowAnimationFrame = null;
      finishAudioProgrammaticScroll();
      return;
    }
    if (audioFollowVirtualScroll === null) audioFollowVirtualScroll = viewport.scrollLeft;
    const delta = audioFollowScrollTarget - audioFollowVirtualScroll;
    if (Math.abs(delta) < 0.15) {
      audioFollowVirtualScroll = audioFollowScrollTarget;
      viewport.scrollLeft = audioFollowVirtualScroll;
      if (!readerAudio.paused && audioFollowEnabled && !manualScrollIntent && !manualScrollActive) {
        audioFollowAnimationFrame = window.requestAnimationFrame(animateAudioFollowScroll);
        return;
      }
      audioFollowScrollTarget = null;
      audioFollowVirtualScroll = null;
      audioFollowAnimationFrame = null;
      finishAudioProgrammaticScroll();
      return;
    }
    const maxStep = Math.max(18, Math.min(48, viewport.clientWidth * 0.08));
    const step = Math.sign(delta) * Math.min(maxStep, Math.abs(delta) * 0.18);
    audioFollowVirtualScroll += step;
    viewport.scrollLeft = audioFollowVirtualScroll;
    audioFollowAnimationFrame = window.requestAnimationFrame(animateAudioFollowScroll);
  }

  function setAudioFollowScrollTarget(target) {
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const nextTarget = Math.max(0, Math.min(max, target));
    audioFollowScrollTarget = nextTarget;
    audioProgrammaticScroll = true;
    window.clearTimeout(audioProgrammaticScrollTimer);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewport.scrollLeft = nextTarget;
      audioFollowScrollTarget = null;
      audioFollowVirtualScroll = null;
      finishAudioProgrammaticScroll();
      return;
    }
    if (audioFollowAnimationFrame === null && Math.abs(nextTarget - viewport.scrollLeft) >= 0.2) {
      audioFollowVirtualScroll = viewport.scrollLeft;
      audioFollowAnimationFrame = window.requestAnimationFrame(animateAudioFollowScroll);
    } else if (audioFollowAnimationFrame === null) {
      audioFollowScrollTarget = null;
      audioFollowVirtualScroll = null;
      finishAudioProgrammaticScroll();
    }
  }

  function scrollPageToAudio(page, currentTime) {
    const element = pageElementFor(page.pageKey);
    if (!element) return;
    currentSourcePage = element.dataset.sourcePage;
    currentSourcePageLabel = element.dataset.sourcePageLabel;
    const duration = Math.max(0.001, page.end - page.start);
    const progress = Math.max(0, Math.min(1, (currentTime - page.start) / duration));
    const activeColumn = element.offsetLeft + element.offsetWidth * (1 - progress);
    setAudioFollowScrollTarget(activeColumn - viewport.clientWidth * 0.72);
  }

  async function syncTextToAudio() {
    if (audioButton.dataset.loading === "true" || !audioFollowEnabled || audioFollowDetached || manualScrollIntent || manualScrollActive || !currentAudioTrack) return;
    if (!audioAlignment && !await ensureAudioAlignment()) return;
    const page = alignmentPageAtTime(readerAudio.currentTime);
    if (!page) return;
    const currentSection = volumeIndex?.sections[activeSectionIndex];
    if (currentSection?.id !== page.sectionId) {
      const targetIndex = volumeIndex.sections.findIndex((section) => section.id === page.sectionId);
      if (targetIndex < 0 || sectionLoading) return;
      const request = ++audioFollowRequest;
      cancelAudioFollowScroll();
      await loadSection(targetIndex, { sourcePage: page.pageKey, pageOffsetRatio: 0, audioFollow: true });
      if (request !== audioFollowRequest) return;
    }
    scrollPageToAudio(page, readerAudio.currentTime);
  }

  function runAudioPlaybackFollowing() {
    audioPlaybackFollowFrame = null;
    if (readerAudio.paused || readerAudio.ended) return;
    if (audioButton.dataset.loading !== "true" && audioFollowEnabled && !audioFollowDetached && !manualScrollIntent && !manualScrollActive && audioAlignment) {
      const page = alignmentPageAtTime(readerAudio.currentTime);
      const currentSection = volumeIndex?.sections[activeSectionIndex];
      if (page && currentSection?.id === page.sectionId) scrollPageToAudio(page, readerAudio.currentTime);
      else if (page && !sectionLoading) syncTextToAudio();
    }
    audioPlaybackFollowFrame = window.requestAnimationFrame(runAudioPlaybackFollowing);
  }

  function startAudioPlaybackFollowing() {
    if (audioPlaybackFollowFrame === null) {
      audioPlaybackFollowFrame = window.requestAnimationFrame(runAudioPlaybackFollowing);
    }
  }

  function stopAudioPlaybackFollowing() {
    if (audioPlaybackFollowFrame !== null) window.cancelAnimationFrame(audioPlaybackFollowFrame);
    audioPlaybackFollowFrame = null;
  }

  function visiblePagePosition() {
    const viewportRect = viewport.getBoundingClientRect();
    const readingAnchor = viewportRect.left + viewportRect.width * 0.72;
    const candidates = [...sutraText.querySelectorAll(".source-page")].map((element) => {
      const rect = element.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportRect.right) - Math.max(rect.left, viewportRect.left));
      return { element, rect, visibleWidth };
    }).filter((item) => item.visibleWidth > 0).sort((a, b) => b.visibleWidth - a.visibleWidth);
    const visible = candidates.find((item) => item.rect.left <= readingAnchor && item.rect.right >= readingAnchor) || candidates[0];
    if (!visible) return null;
    return {
      pageKey: visible.element.dataset.sourcePage,
      progress: Math.max(0, Math.min(1, (visible.rect.right - readingAnchor) / Math.max(1, visible.rect.width)))
    };
  }

  function seekAudioToVisibleText() {
    if (!audioAlignment || !readerAudio.getAttribute("src") || !currentAudioTrack) return false;
    const position = visiblePagePosition();
    let page = position ? audioAlignment.pagesByKey.get(position.pageKey) : null;
    let pageProgress = position?.progress || 0;
    if (!page || !page.spoken || page.end <= page.start) {
      const trackNumber = currentAudioTrack.url.match(/\/(\d+)\.m4a$/)?.[1];
      const trackPages = audioAlignment.pagesByTrack.get(trackNumber) || [];
      const currentSectionId = volumeIndex?.sections[activeSectionIndex]?.id;
      const sectionPages = trackPages.filter((candidate) => candidate.sectionId === currentSectionId);
      const fallbackPages = sectionPages.length ? sectionPages : trackPages;
      const pageIndex = trackPages.findIndex((candidate) => candidate.pageKey === position?.pageKey);
      const useTrackEnd = pageIndex < 0 && viewport.scrollLeft <= PULL_EDGE_TOLERANCE;
      const nextSpokenPage = pageIndex < 0
        ? (useTrackEnd ? null : fallbackPages.find((candidate) => candidate.spoken && candidate.end > candidate.start))
        : trackPages.slice(pageIndex + 1).find((candidate) => candidate.spoken && candidate.end > candidate.start);
      const previousSpokenPage = pageIndex < 0
        ? (useTrackEnd ? [...fallbackPages].reverse().find((candidate) => candidate.spoken && candidate.end > candidate.start) : null)
        : trackPages.slice(0, pageIndex).reverse().find((candidate) => candidate.spoken && candidate.end > candidate.start);
      page = nextSpokenPage || previousSpokenPage;
      pageProgress = nextSpokenPage ? 0 : 1;
    }
    if (!page) return false;
    const nextTime = page.start + (page.end - page.start) * pageProgress;
    try {
      readerAudio.currentTime = Math.max(0, Math.min(readerAudio.duration || nextTime, nextTime));
    } catch (_error) {
      return false;
    }
    return true;
  }

  function markManualScrollIntent() {
    cancelAudioFollowScroll();
    manualScrollIntent = true;
    window.clearTimeout(manualScrollIntentTimer);
    manualScrollIntentTimer = window.setTimeout(() => { manualScrollIntent = false; }, 1200);
  }

  function handleViewportScroll() {
    updateProgress();
    if (audioProgrammaticScroll || (!manualScrollIntent && !manualScrollActive)) return;
    if (!manualScrollActive) {
      manualScrollStartedWhileFollowing = audioFollowEnabled && !readerAudio.paused && Boolean(readerAudio.getAttribute("src"));
    }
    manualScrollActive = true;
    if (manualScrollStartedWhileFollowing) setAudioFollowDetached(true);
    window.clearTimeout(manualScrollTimer);
    manualScrollTimer = window.setTimeout(finishManualScroll, 320);
  }

  function finishManualScroll() {
    if (!manualScrollActive) return;
    manualScrollActive = false;
    manualScrollIntent = false;
    if (manualScrollStartedWhileFollowing && !readerAudio.paused) setAudioFollowDetached(true, { showPrompt: true });
    manualScrollStartedWhileFollowing = false;
  }

  function returnToAudioPosition() {
    hideAudioFollowPrompt();
    setAudioFollowDetached(false);
    syncTextToAudio();
    if (!readerAudio.paused) startAudioPlaybackFollowing();
  }

  async function replayFromVisibleText() {
    if (!await ensureAudioAlignment() || !seekAudioToVisibleText()) {
      showToast("目前頁面沒有可對應的讀誦位置");
      return;
    }
    hideAudioFollowPrompt();
    setAudioFollowDetached(false);
    syncTextToAudio();
    startAudioPlaybackFollowing();
  }

  function updateAudioForSection(section) {
    const nextTrack = getAudioTrack(section);
    if (!nextTrack) {
      audioStartRequest += 1;
      cancelAudioFollowScroll();
      audioFollowDetached = false;
      audioFollowEnabled = true;
      hideAudioFollowPrompt();
      currentAudioTrack = null;
      readerAudio.pause();
      readerAudio.removeAttribute("src");
      readerAudio.load();
      audioButton.textContent = "聽";
      audioButton.disabled = false;
      audioButton.dataset.loading = "false";
      audioButton.dataset.unavailable = "true";
      audioButton.setAttribute("aria-label", "本節沒有對應的讀誦音頻");
      audioButton.dataset.playing = "false";
      return;
    }

    audioButton.dataset.unavailable = "false";
    if (currentAudioTrack?.key === nextTrack.key) {
      audioButton.setAttribute("aria-label", readerAudio.paused
        ? `從目前閱讀位置開始聽${nextTrack.title}`
        : `暫停${nextTrack.title}`);
      return;
    }
    audioStartRequest += 1;
    cancelAudioFollowScroll();
    audioFollowDetached = false;
    audioFollowEnabled = true;
    hideAudioFollowPrompt();
    readerAudio.pause();
    readerAudio.removeAttribute("src");
    readerAudio.load();
    currentAudioTrack = nextTrack;
    audioButton.textContent = "聽";
    audioButton.disabled = false;
    audioButton.dataset.loading = "false";
    audioButton.dataset.playing = "false";
    audioButton.setAttribute("aria-label", `從目前閱讀位置開始聽${nextTrack.title}`);
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
        <span><strong>${section.title}</strong></span>
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
    sourcePageLabel.textContent = `${volumeIndex.sourceName || "圓道禪院"}漢語拼音版`;
    document.getElementById("previousSection").disabled = activeSectionIndex === 0;
    document.getElementById("nextSection").disabled = activeSectionIndex === volumeIndex.sections.length - 1;
    document.querySelectorAll("#tocList button[data-index]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.index) === activeSectionIndex);
      if (Number(button.dataset.index) === activeSectionIndex) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    updateAudioForSection(section);
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
    markManualScrollIntent();
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
    markManualScrollIntent();
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
      scheduleSave();
    }, { root: viewport, threshold: [0.25, 0.5, 0.75] });
    pages.forEach((page) => pageObserver.observe(page));
  }

  async function loadSection(index, restorePosition = { ratio: 0 }) {
    if (!volumeIndex || index < 0 || index >= volumeIndex.sections.length) return;
    const requestId = ++sectionRequest;
    const isAudioTransition = restorePosition?.audioFollow === true;
    sectionLoading = true;
    activeSectionIndex = index;
    const section = volumeIndex.sections[index];
    currentSourcePage = null;
    currentSourcePageLabel = null;
    resetPullGesture();
    updateSectionUi(section);
    if (isAudioTransition) {
      sutraText.classList.add("audio-transitioning");
      sutraText.setAttribute("aria-busy", "true");
    } else {
      sutraText.classList.remove("audio-transitioning");
      sutraText.removeAttribute("aria-busy");
      sutraText.innerHTML = '<div class="reader-loading"><span class="loading-seal" aria-hidden="true">經</span><p>正在展卷…</p></div>';
    }

    try {
      const response = await fetch(`./${section.content}`);
      if (!response.ok) throw new Error(`section ${response.status}`);
      const data = await response.json();
      if (requestId !== sectionRequest) return;

      const pages = data.pages.map((page) => page.facsimile
        ? `<section class="source-page facsimile-page" id="page-${page.pageKey}" data-source-page="${page.pageKey}" data-source-page-label="${page.pageLabel}" aria-label="${page.pageLabel}圖像">
            <img src="./${page.facsimile}" alt="經書原頁影像" loading="lazy" decoding="async">
          </section>`
        : `<section class="source-page" id="page-${page.pageKey}" data-source-page="${page.pageKey}" data-source-page-label="${page.pageLabel}" aria-label="經文">
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
          <small><a href="${volumeIndex.sourceUrl}" target="_blank" rel="noreferrer">文本來源 · ${volumeIndex.sourceName || "圓道禪院"}漢語拼音版</a></small>
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
        if (isAudioTransition) {
          window.requestAnimationFrame(() => {
            sutraText.classList.remove("audio-transitioning");
            sutraText.removeAttribute("aria-busy");
          });
        }
      });
    } catch (_error) {
      if (requestId !== sectionRequest) return;
      sectionLoading = false;
      sutraText.classList.remove("audio-transitioning");
      sutraText.removeAttribute("aria-busy");
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
    discardLegacyAudioProgress();
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
  audioButton.addEventListener("pointerdown", prepareAudioPlayback, { passive: true });
  audioButton.addEventListener("click", toggleAudioPlayback);
  audioPromptReturnButton.addEventListener("click", returnToAudioPosition);
  audioReplayHereButton.addEventListener("click", replayFromVisibleText);
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("fontDecrease").addEventListener("click", () => shiftFontScale(-1));
  document.getElementById("fontIncrease").addEventListener("click", () => shiftFontScale(1));
  document.getElementById("fontReset").addEventListener("click", () => setFontScale(100));
  pinyinToggle.addEventListener("click", togglePinyin);
  document.getElementById("previousSection").addEventListener("click", () => loadSection(activeSectionIndex - 1, { ratio: 0 }));
  document.getElementById("nextSection").addEventListener("click", goToNextSection);
  document.addEventListener("sutra:theme", updateSettingsUi);

  readerAudio.addEventListener("timeupdate", () => {
    if (!readerAudio.paused) syncTextToAudio();
  });
  readerAudio.addEventListener("seeked", () => {
    if (audioFollowEnabled) syncTextToAudio();
  });
  readerAudio.addEventListener("play", () => {
    audioButton.dataset.playing = "true";
    if (audioButton.dataset.loading !== "true") {
      audioButton.textContent = "停";
      audioButton.setAttribute("aria-label", `暫停${currentAudioTrack?.title || "誦經音頻"}`);
    }
    startAudioPlaybackFollowing();
  });
  readerAudio.addEventListener("pause", () => {
    stopAudioPlaybackFollowing();
    cancelAudioFollowScroll();
    audioFollowDetached = false;
    audioFollowEnabled = true;
    hideAudioFollowPrompt();
    audioButton.dataset.playing = "false";
    audioButton.textContent = "聽";
    audioButton.setAttribute("aria-label", currentAudioTrack
      ? `從目前閱讀位置開始聽${currentAudioTrack.title}`
      : "本節沒有對應的讀誦音頻");
    saveProgress();
  });
  readerAudio.addEventListener("ended", () => {
    stopAudioPlaybackFollowing();
    hideAudioFollowPrompt();
    audioButton.dataset.playing = "false";
    audioButton.textContent = "聽";
    audioButton.setAttribute("aria-label", `從目前閱讀位置開始聽${currentAudioTrack?.title || "本卷"}`);
    saveProgress();
    showToast(`${currentAudioTrack?.title || "本卷"}播放完畢`);
  });
  readerAudio.addEventListener("error", () => {
    if (currentAudioTrack) showToast("音頻暫時無法載入，請檢查網路後重試");
  });

  viewport.addEventListener("scroll", handleViewportScroll, { passive: true });
  viewport.addEventListener("pointerdown", markManualScrollIntent, { passive: true });
  viewport.addEventListener("touchstart", handleTouchStart, { passive: true });
  viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
  viewport.addEventListener("touchend", handleTouchEnd, { passive: true });
  viewport.addEventListener("touchcancel", resetPullGesture, { passive: true });
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("pagehide", saveProgress);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveProgress(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeToc(); closeSettings(); }
    if (event.target.closest("button, a, input, audio")) return;
    if (event.key === "ArrowLeft" || event.key === "PageDown") {
      markManualScrollIntent();
      viewport.scrollBy({ left: -viewport.clientWidth * 0.82, behavior: "smooth" });
    }
    if (event.key === "ArrowRight" || event.key === "PageUp") {
      markManualScrollIntent();
      viewport.scrollBy({ left: viewport.clientWidth * 0.82, behavior: "smooth" });
    }
  });

  initialize();
})();

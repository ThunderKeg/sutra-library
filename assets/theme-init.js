(function () {
  "use strict";

  const validThemes = new Set(["paper", "eye", "night"]);
  const validScales = new Set([80, 90, 100, 110, 120, 130, 140]);
  const root = document.documentElement;

  function read(key, fallback) {
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch (_error) {
      return fallback;
    }
  }

  const storedTheme = read("sutra-theme", "paper");
  const storedScale = Number(read("sutra-font-scale", "100"));
  const storedPinyin = read("sutra-pinyin", "on");

  root.dataset.theme = validThemes.has(storedTheme) ? storedTheme : "paper";
  root.dataset.readerFontScale = String(validScales.has(storedScale) ? storedScale : 100);
  root.dataset.pinyin = storedPinyin === "off" ? "off" : "on";
})();

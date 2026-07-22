# 藏經閣

面向 GitHub Pages 的靜態經書 PWA。第一個原型是《大方廣佛華嚴經》漢語拼音版第一冊：繁體正文、豎排閱讀、逐字拼音、七級字號、護眼／夜讀色調、目錄跳轉、斷點續讀和離線快取。

## 本地預覽

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

打開 `http://127.0.0.1:8000/`。不要直接雙擊 HTML；Service Worker 需要 HTTP 或 HTTPS。

## 重新生成華嚴經第一冊

原始 PDF 放在 `sources/pdf/2020-HuaYanJing-pinyin-01.pdf`，它已被 `.gitignore` 排除，不會隨 GitHub Pages 發布。

```powershell
python -m pip install -r requirements.txt
python scripts/build_huayan.py
python scripts/generate_icons.py
python scripts/check_site.py
node --check assets/app.js
node --check assets/reader.js
node --check sw.js
```

PDF 的繁體正文有可用文字層；原拼音使用自訂字形映射，Unicode 內容不是畫面上的拉丁拼音。因此生成器只提取大字繁體正文，再用 `pypinyin` 生成帶聲調的自動校注。公開使用前仍應抽樣校對多音字和佛教專名。

## GitHub Pages

`.github/workflows/pages.yml` 會在 `main` 分支推送后發布整個靜態網站。首次使用時，在 GitHub 倉庫 Settings → Pages 將 Source 設為 **GitHub Actions**。

## 來源與發布注意

- PDF 下載頁：圓道禪院《大方廣佛華嚴經 漢語拼音版電子檔下載》
- 第一冊原檔共 624 PDF 頁；正文由原檔提取，網站顯示原書頁碼。
- 下載頁提供公開下載，但未在頁面上標示開放授權。將正文公開發布到 GitHub Pages 前，請自行確認再發布權限；本項目保留來源鏈接和譯者資訊。

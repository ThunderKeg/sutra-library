# 藏经阁

面向 GitHub Pages 的静态经书 PWA。应用内名称显示为“藏經閣”。第一个原型是《大方廣佛華嚴經》汉语拼音版第一册：繁体正文、竖排阅读、原书逐字拼音、七级字号、护眼／夜读色调、目录跳转、精确续读到具体原书页、章节边界续拉切换，以及用户主动下载整册离线阅读。

项目协作规则见 [`AGENTS.md`](AGENTS.md)，华严经内容与排版要求见 [`docs/huayan-typesetting.md`](docs/huayan-typesetting.md)。

## 本地预览

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/`。不要直接双击 HTML；Service Worker 需要 HTTP 或 HTTPS。

## 重新生成华严经第一册

原始 PDF 放在 `sources/pdf/2020-HuaYanJing-pinyin-01.pdf`，它已被 `.gitignore` 排除，不会随 GitHub Pages 发布。

```powershell
python -m pip install -r requirements.txt
python scripts/build_huayan.py
python scripts/generate_icons.py
python scripts/check_site.py
python scripts/audit_huayan.py
node --check assets/app.js
node --check assets/reader.js
node --check sw.js
git diff --check
```

PDF 的繁体正文有可用文字层；原拼音使用自定义字形映射，Unicode 内容不是画面上的拉丁拼音。生成器通过嵌入字形轮廓解码原书拼音，并按逐字坐标重建从右向左的正文栏序。PDF 文字映射遗漏的 41 个大字已根据原页字形补回；前置资料、悉昙／华严字母表与附录等复杂页面使用无损原页影像保真。

## 加载与离线策略

- 首次打开阅读器只加载册次索引和当前章节，不自动下载整册。
- 已经打开的章节会进入运行时缓存。
- 完整离线阅读需要用户在藏书目录或阅读设置中点击“下载整册离线阅读”。
- 下载逐项进行并显示进度；中断后重试不会重复下载已保存资源。

## GitHub Pages

`.github/workflows/pages.yml` 会在 `main` 分支推送后发布整个静态网站。首次使用时，在 GitHub 仓库 Settings → Pages 将 Source 设置为 **GitHub Actions**。

## 来源与发布注意

- PDF 下载页：圓道禪院《大方廣佛華嚴經 漢語拼音版電子檔下載》
- 第一册原文件共 624 个 PDF 页，网站按 PDF 页 1–624 完整收录；正文显示原书页码，前九页使用 PDF 前置页码。
- 下载页提供公开下载，但未在页面上标示开放授权。将正文公开发布到 GitHub Pages 前，请自行确认再发布权限；本项目保留来源链接和译者信息。

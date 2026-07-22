# 藏经阁

面向 GitHub Pages 的静态经书 PWA。应用内名称显示为“藏經閣”。第一个原型是《大方廣佛華嚴經》汉语拼音版第一册：繁体正文、竖排阅读、原书逐字拼音、七级字号、护眼／夜读色调、目录跳转、精确续读到具体原书页、章节边界续拉切换，以及用户主动下载整册离线阅读。

## 收录版本

本项目收录唐于闐國三藏沙門實叉難陀譯《大方廣佛華嚴經》八十卷（通称“八十华严”），以圓道禪院[《大方廣佛華嚴經 漢語拼音版電子檔下載》](https://yuandao-world.org/2020/04/14/%E5%A4%A7%E6%96%B9%E5%BB%A3%E4%BD%9B%E8%8F%AF%E5%9A%B4%E7%B6%93-%E6%BC%A2%E8%AA%9E%E6%8B%BC%E9%9F%B3%E7%89%88%E9%9B%BB%E5%AD%90%E6%AA%94%E4%B8%8B%E8%BC%89/)页面提供的八册 PDF 为底本。当前网站已开放第一册，对应卷一至卷十；其余册次尚未生成可阅读的网页版本。

第一册的诵经音频采用慧平法师读诵版本，来源为佛弟子文库[《八十华严（慧平法师）》](https://www.fodizi.net/fojing/23/7444.html)。音频由来源站点的 CDN 在线串流，本项目不保存或重新分发音频文件，也不把音频纳入整册离线下载。卷次与音轨的具体对应关系记录在 [`docs/huayan-typesetting.md`](docs/huayan-typesetting.md)。

项目协作规则见 [`AGENTS.md`](AGENTS.md)，华严经内容与排版要求见 [`docs/huayan-typesetting.md`](docs/huayan-typesetting.md)。

## Python 环境与依赖

在仓库根目录创建独立虚拟环境，并通过该环境安装项目依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

后续运行项目脚本前先激活 `.venv`，不要将依赖安装到系统 Python。

## 本地预览

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/`。不要直接双击 HTML；Service Worker 需要 HTTP 或 HTTPS。

## 重新生成华严经第一册

原始 PDF 放在 `sources/pdf/2020-HuaYanJing-pinyin-01.pdf`，它已被 `.gitignore` 排除，不会随 GitHub Pages 发布。

```powershell
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

- PDF 下载页：圓道禪院[《大方廣佛華嚴經 漢語拼音版電子檔下載》](https://yuandao-world.org/2020/04/14/%E5%A4%A7%E6%96%B9%E5%BB%A3%E4%BD%9B%E8%8F%AF%E5%9A%B4%E7%B6%93-%E6%BC%A2%E8%AA%9E%E6%8B%BC%E9%9F%B3%E7%89%88%E9%9B%BB%E5%AD%90%E6%AA%94%E4%B8%8B%E8%BC%89/)
- 音频来源页：佛弟子文库[《八十华严（慧平法师）》](https://www.fodizi.net/fojing/23/7444.html)
- 第一册原文件共 624 个 PDF 页，网站按 PDF 页 1–624 完整收录；正文显示原书页码，前九页使用 PDF 前置页码。
- 下载页提供公开下载，但未在页面上标示开放授权。将正文公开发布到 GitHub Pages 前，请自行确认再发布权限；本项目保留来源链接和译者信息。

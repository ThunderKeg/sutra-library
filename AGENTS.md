# 项目协作说明

## ⚠️ 强制阅读索引：华严经内容与排版

> [!IMPORTANT]
> 任何涉及《大方廣佛華嚴經》的正文、拼音、页序、章节、影印页、生成器、阅读版式或续读行为的任务，开始修改前必须完整阅读 [`docs/huayan-typesetting.md`](docs/huayan-typesetting.md)。不能只依据本文件中的摘要，也不能跳过该规范直接修改生成结果。

以下路径发生改动时，视为触发上述强制阅读要求：

- `scripts/build_huayan.py`
- `scripts/huayan_pinyin_overrides.json`
- `data/huayan/**`
- `assets/facsimiles/huayan-01/**`
- `reader.html`、`assets/reader.js`、`assets/styles.css` 中与经文呈现或阅读交互有关的部分
- `scripts/audit_huayan.py`、`scripts/check_site.py` 中与华严经基线有关的部分

规范入口：**[`docs/huayan-typesetting.md`](docs/huayan-typesetting.md)**

## 适用范围

本文件适用于整个仓库。修改任何代码、数据、项目文档或发布配置前，应先阅读本文件；处理《大方廣佛華嚴經》内容时，还必须阅读 [`docs/huayan-typesetting.md`](docs/huayan-typesetting.md)。

## 项目结构

```text
.
├─ index.html                    # 藏书阁首页和藏书目录容器
├─ reader.html                   # 经书阅读器页面和阅读设置面板
├─ offline.html                  # 未缓存页面的离线兜底页
├─ manifest.webmanifest          # PWA 元数据和图标配置
├─ sw.js                         # 应用壳、运行时缓存和主动整册下载
├─ assets/
│  ├─ app.js                     # 全站主题、安装、书目和 PWA 更新逻辑
│  ├─ reader.js                  # 章节加载、目录、续读和翻页交互
│  ├─ styles.css                 # 首页、阅读器、竖排和护眼主题样式
│  ├─ icons/                     # PWA 图标
│  └─ facsimiles/huayan-01/      # 第一册复杂页面的无损 WebP 影印图
├─ data/
│  ├─ library.json               # 经书及册次目录
│  └─ huayan/
│     ├─ volume-01-index.json    # 第一册章节、页码、统计及离线资源索引
│     └─ volume-01/*.json        # 按章节生成的页面、正文和拼音数据
├─ scripts/
│  ├─ build_huayan.py            # 从原始 PDF 生成第一册网页数据和影印图
│  ├─ huayan_pinyin_overrides.json # 经原页核验的拼音解码覆盖
│  ├─ audit_huayan.py            # 独立于生成器的全文与版面审计
│  ├─ check_site.py              # 站点结构、阅读功能和 PWA 静态检查
│  └─ generate_icons.py          # 生成 PWA 图标
├─ sources/pdf/                  # 本地原始 PDF；由 .gitignore 排除
├─ docs/huayan-typesetting.md    # 华严经内容保真和排版规范
└─ .github/workflows/pages.yml   # main 推送后的 GitHub Pages 发布流程
```

## 内容与生成规则

- 原始 PDF 是经文、拼音、页序和复杂版面的最高依据，不提交到 Git。
- `scripts/build_huayan.py` 和 `scripts/huayan_pinyin_overrides.json` 是生成逻辑的源文件；不要只手工修改 `data/huayan/` 下的生成结果。
- 修改生成逻辑或拼音覆盖后，必须重新生成第一册并运行独立审计。
- 普通经文页生成 HTML；前置资料、悉昙字形表、华严字母表、附录等无法可靠转换的页面使用无损影印图，不得以不完整文本替代。
- 不得在读者可见内容中加入“拼音如何生成”“原 PDF 第几页”等技术说明。只保留必要的原始文本、译者信息和文本来源。

## 前端与 PWA 规则

- 首次进入阅读器只加载目录索引和当前章节，禁止自动预取整册正文或全部影印图。
- “下载整册离线阅读”必须由用户主动触发，下载过程应显示进度，并允许失败后续传缺失资源。
- 修改前端静态资源时，同时更新 `assets/app.js` 中的 `APP_VERSION` 和 `sw.js` 中的 `CACHE_VERSION`。
- 检测到新版本后必须显示更新提示；只有用户点击确认后才能激活新 Service Worker 并刷新页面，不得在后台强制刷新正在阅读的页面。
- 只有经书内容或离线资源格式发生变化时，才更新 `OFFLINE_BOOK_CACHE` 版本；普通界面更新不得清除用户已主动下载的整册内容。
- 续读数据必须保持章节、原书页键和页内位置稳定；不要随意更改既有 `section.id`、`pageKey` 或进度存储结构。

## 验证要求

安装依赖后执行：

```powershell
python scripts/check_site.py
python scripts/audit_huayan.py
node --check assets/app.js
node --check assets/reader.js
node --check sw.js
git diff --check
```

- 修改经文、拼音、页序、生成器或影印策略时，以上检查全部必跑。
- 仅修改界面或项目文档时，至少运行 `python scripts/check_site.py`、相关 JavaScript 语法检查和 `git diff --check`。
- 修改交互、响应式布局或 PWA 行为时，应通过本地 HTTP 服务在手机尺寸下进行浏览器验证；不要直接双击 HTML 测试 Service Worker。

## 提交边界

- 不提交 `sources/pdf/*.pdf`、`.idea/`、`__pycache__/`、`*.pyc` 或本地预览产物。
- 工作区存在无关改动时，只暂存本任务涉及的文件。
- 未经明确要求，不执行 commit、push、发布或部署操作。

# 站点更新日志

<!--
  格式约定（每条日志一个 ## 区块）：

  ## 更新标题

  - 日期：YYYY-MM-DD
  - 类型：feat | fix | style | refactor | chore
  - 页面：home / archive / list（页面标识，多个用 / 分隔，可用标识见 src/utils/changelog.ts 的 PAGE_META）
  - 简述：卡片上显示的一句话

  这里是详情正文（弹窗中显示），支持多段落，空行分段。

  最新记录写在最上面。
-->
## 从 astro-koharu 迁移到 Firefly-Mod

- 日期：2026-10-23
- 类型：refactor
- 页面：home / archive / list / post
- 简述：整站换成 Firefly-Mod，文章、封面与配置全部迁移

1. 文章从 `src/content/blog/` 迁到 `src/content/posts/`，frontmatter 按新 schema 改写（`date` → `published`、`cover` → `image`、`categories` → `category`、`sticky` → `pinned`）。

2. 封面图与原站图片整体搬到 `public/img/`，旧链接通过 `vercel.json` 的 301 规则（`/post/:slug` → `/posts/:slug/`）保留可达性。

3. 站点配置从 `config/site.yaml` 迁到 `src/config/*.ts`：站点名、副标题、域名、主题色、友链、歌单与关于页。

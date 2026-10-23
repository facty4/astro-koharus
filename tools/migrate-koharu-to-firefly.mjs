#!/usr/bin/env node
/**
 * migrate-koharu-to-firefly.mjs
 *
 * 把 astro-koharu（余弦の博客 / facty4-astro-koharus）的文章迁移成
 * Firefly-Mod（MmzMing/my-blog）的格式。
 *
 * 用法（在 Firefly-Mod 新仓库根目录执行，且已 pnpm install）：
 *
 *   node tools/migrate-koharu-to-firefly.mjs --old ../astro-koharus
 *
 * 常用参数：
 *   --old <dir>         旧仓库路径（必填，指到包含 src/content/blog 的根目录）
 *   --new <dir>         新仓库路径（默认当前目录）
 *   --dry-run           只打印计划和报告，不写任何文件
 *   --copy-public-img   把旧仓库 public/img 整个复制到新仓库（封面对路径 /img/... 的必须）
 *   --include-locales   连 en/ ja/ 等译文目录一起迁移（默认跳过）
 *
 * 产物：
 *   <new>/src/content/posts/*.md        迁移后的文章（扁平化文件名）
 *   <new>/migration-report.json         逐篇字段映射、丢失字段、警告
 *   <new>/vercel-redirects.json         可直接并入 vercel.json 的 301 重定向
 *
 * 说明：
 *   - 文章 slug 优先取 `link`，否则取文件名（去掉 YYYY-MM-DD- 前缀）。
 *   - 目录（life/note/tools/...）在 koharu 里只是分类容器、不进 URL；
 *     Firefly 用文件名当 slug，所以这里统一扁平化到 posts/ 下。
 *   - 正文里 koharu 独有的 Shoka 语法（::: 容器、::tag、{ruby}、!!spoiler!!、
 *     练习题、:::encrypted）不会自动改写，只在报告里标注出来，需要人工处理。
 */

import fs from "node:fs";
import path from "node:path";

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const getArg = (name, fallback = null) => {
	const i = argv.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = argv[i + 1];
	return v && !v.startsWith("--") ? v : true;
};
const flag = (name) => argv.includes(`--${name}`);

const OLD = getArg("old");
const NEW = getArg("new", process.cwd());
const DRY = flag("dry-run");
const COPY_PUBLIC_IMG = flag("copy-public-img");
const INCLUDE_LOCALES = flag("include-locales");

if (!OLD) {
	console.error("缺少 --old 参数。示例：node tools/migrate-koharu-to-firefly.mjs --old ../astro-koharus");
	process.exit(1);
}

const OLD_ROOT = path.resolve(OLD);
const NEW_ROOT = path.resolve(NEW);
const OLD_POSTS = path.join(OLD_ROOT, "src", "content", "blog");
const NEW_POSTS = path.join(NEW_ROOT, "src", "content", "posts");

if (!fs.existsSync(OLD_POSTS)) {
	console.error(`找不到旧文章目录：${OLD_POSTS}`);
	console.error("请确认 --old 指向 astro-koharu 仓库根目录。");
	process.exit(1);
}
if (!fs.existsSync(NEW_POSTS)) {
	console.error(`找不到新文章目录：${NEW_POSTS}`);
	console.error("请确认 --new 指向 Firefly-Mod 仓库根目录，并已安装依赖。");
	process.exit(1);
}

// ---------- 依赖 ----------
let matter;
try {
	({ default: matter } = await import("gray-matter"));
} catch {
	console.error("缺少依赖 gray-matter。请在 Firefly-Mod 仓库根目录运行，或先执行：pnpm add -D gray-matter");
	process.exit(1);
}

// ---------- 工具函数 ----------
const walk = (dir) =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) return walk(p);
		return /\.(md|mdx)$/i.test(e.name) ? [p] : [];
	});

const pad = (n) => String(n).padStart(2, "0");

/** 把 Date / 字符串统一成 YAML 可解析成 Date 的 `YYYY-MM-DD HH:mm:ss`（不加引号） */
function toYamlDate(value) {
	if (!value) return null;
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		// js-yaml 把无时区的 "2024-01-05 00:00:00" 解析成 UTC，用 UTC 分量回读可原样还原墙上时间
		return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(
			value.getUTCHours(),
		)}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
	}
	const s = String(value).trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
	if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
		return s.replace("T", " ").replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/, "$1:00");
	}
	// ISO 带时区：转成本地墙上时间字段（保留原意，不强行换算时区）
	const d = new Date(s);
	if (!Number.isNaN(d.getTime())) return toYamlDate(d);
	return s;
}

const quote = (v) => JSON.stringify(String(v)); // JSON 字符串是合法的 YAML 双引号标量

const isBlank = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** categories 可能是 ["随笔"]，也可能是 [["笔记","前端"]] 这种多级结构 */
function flattenCategories(raw) {
	if (isBlank(raw)) return [];
	const list = Array.isArray(raw) ? raw : [raw];
	const out = [];
	for (const item of list) {
		if (Array.isArray(item)) out.push(item.filter(Boolean).join("/"));
		else if (typeof item === "string") out.push(item);
	}
	return out.filter(Boolean);
}

// koharu 的目录只是分类容器，不是 URL 的一部分；首个路径段用于兜底分类
const dirCategory = (rel) => {
	const parts = rel.split(/[\\/]/);
	return parts.length > 1 ? parts[0] : "";
};

// ---------- 收集旧文章 ----------
const LOCALE_DIR = /^[a-z]{2}(-[A-Z]{2})?$/;
const files = walk(OLD_POSTS).filter((f) => {
	if (INCLUDE_LOCALES) return true;
	const rel = path.relative(OLD_POSTS, f);
	const first = rel.split(/[\\/]/)[0];
	return !(LOCALE_DIR.test(first) && first !== "zh");
});

const usedSlugs = new Map(); // slug -> 旧文件
const entries = [];
const warnings = [];

for (const file of files) {
	const rel = path.relative(OLD_POSTS, file);
	let src;
	try {
		src = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
	} catch (e) {
		warnings.push({ file: rel, level: "error", message: `读取失败：${e.message}` });
		continue;
	}
	const parsed = matter(src);
	const d = parsed.data ?? {};

	const baseName = path.basename(file, path.extname(file)).replace(/^\d{4}-\d{2}-\d{2}[-_]?/, "");
	let slug = (typeof d.link === "string" && d.link.trim()) || baseName;
	slug = slug
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.replace(/[\\/]+/g, "-");

	const oldSlug = slug; // 旧站 URL 用的 slug（重命名前）
	// 扁平化后可能出现重名：加分类前缀
	if (usedSlugs.has(slug)) {
		const prefixed = `${dirCategory(rel) || "post"}-${slug}`;
		warnings.push({
			file: rel,
			level: "warn",
			message: `slug "${slug}" 与 ${usedSlugs.get(slug)} 重复，已改名为 "${prefixed}"`,
		});
		slug = prefixed;
	}
	usedSlugs.set(slug, rel);

	const categories = flattenCategories(d.categories);
	const category = categories[0] || dirCategory(rel) || "";
	const extraCategories = categories.slice(1);

	const tags = Array.isArray(d.tags) ? d.tags.map(String) : [];
	for (const c of extraCategories) if (!tags.includes(c)) tags.push(c);

	const published = toYamlDate(d.date ?? d.published);
	const updated = d.updated ? toYamlDate(d.updated) : null;

	// 正文里 koharu 独有、需要人工确认的语法
	const body = parsed.content;
	const shokaHits = [];
	if (/^:::/m.test(body)) shokaHits.push("::: 容器（提醒块/标签卡/加密块）");
	if (/^;;;/m.test(body)) shokaHits.push(";;; 标签卡");
	if (/^\+\+\+/m.test(body)) shokaHits.push("+++ 折叠块");
	if (/\{[^}\n]+\^\^?[^}\n]*\}/.test(body)) shokaHits.push("{注音} 语法");
	if (/!![^!\n]+!!/.test(body)) shokaHits.push("!!隐藏文字!!");
	if (/\{%\s*(links|media|codeblock)\b/.test(body)) shokaHits.push("{% Hexo 标签 %}");
	if (/::quiz|::choice|\{quiz\}/.test(body)) shokaHits.push("练习题");
	if (shokaHits.length)
		warnings.push({ file: rel, level: "warn", message: `正文含 koharu 专有语法：${shokaHits.join("、")}` });

	if (!published) warnings.push({ file: rel, level: "warn", message: "缺少 date，published 留空会构建失败，请手填" });

	entries.push({
		file,
		rel,
		slug,
		oldSlug,
		frontmatter: {
			title: d.title ?? baseName,
			published,
			updated,
			draft: d.draft === true,
			description: d.description ?? "",
			image: d.cover ?? "",
			tags,
			category,
			lang: "",
			pinned: d.sticky === true,
			password: d.password ?? "",
			comment: true,
		},
		body,
		dropped: Object.keys(d).filter(
			(k) =>
				![
					"title",
					"date",
					"updated",
					"description",
					"cover",
					"tags",
					"categories",
					"draft",
					"sticky",
					"password",
					"link",
				].includes(k),
		),
	});
}

// ---------- 生成 frontmatter 文本 ----------
function renderMarkdown(entry) {
	const f = entry.frontmatter;
	const lines = ["---"];
	lines.push(`title: ${quote(f.title)}`);
	if (f.published) lines.push(`published: ${f.published}`);
	if (f.updated) lines.push(`updated: ${f.updated}`);
	lines.push(`draft: ${f.draft}`);
	lines.push(`description: ${quote(f.description)}`);
	if (f.image) lines.push(`image: ${quote(f.image)}`);
	lines.push(`tags: [${f.tags.map(quote).join(", ")}]`);
	if (f.category) lines.push(`category: ${quote(f.category)}`);
	if (f.lang) lines.push(`lang: ${quote(f.lang)}`);
	lines.push(`pinned: ${f.pinned}`);
	if (f.password) lines.push(`password: ${quote(f.password)}`);
	lines.push(`comment: ${f.comment}`);
	lines.push("---");
	return `${lines.join("\n")}\n\n${entry.body.replace(/^\n+/, "")}\n`;
}

// ---------- 写入 ----------
if (!DRY) {
	for (const entry of entries) {
		fs.writeFileSync(path.join(NEW_POSTS, `${entry.slug}.md`), renderMarkdown(entry), "utf8");
	}
}

// ---------- 重定向表 ----------
const redirects = [];
for (const e of entries) {
	redirects.push({
		source: `/post/${e.oldSlug}`,
		destination: `/posts/${e.slug}/`,
		permanent: true,
	});
}
// koharu 的固定页面 → Firefly 的对应页面
const staticRedirects = [
	["/archives", "/archive/"],
	["/posts/", "/list/"],
	["/weekly", "/archive/"],
	["/bangumi", "/"],
	["/music", "/"],
];

// 去重：同一 source 只保留第一条（slug 冲突时旧 URL 本来就撞车，只能保留一篇的可达性）
for (const [source, destination] of staticRedirects) {
	redirects.push({ source, destination, permanent: true });
}
const seenSources = new Set();
const uniqueRedirects = [];
for (const r of redirects) {
	if (seenSources.has(r.source)) {
		warnings.push({
			level: "warn",
			message: `重定向 ${r.source} 重复，已保留第一条（另有文章共用这个旧 URL）`,
		});
		continue;
	}
	seenSources.add(r.source);
	uniqueRedirects.push(r);
}
redirects.length = 0;
redirects.push(...uniqueRedirects);

// ---------- 复制图片（可选，先做，warning 才会进报告） ----------
if (!DRY && COPY_PUBLIC_IMG) {
	const from = path.join(OLD_ROOT, "public", "img");
	const to = path.join(NEW_ROOT, "public", "img");
	if (fs.existsSync(from)) {
		fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
		console.log(`已复制封面/图片：${from} -> ${to}`);
	} else {
		warnings.push({ level: "warn", message: `旧仓库没有 public/img：${from}` });
	}
}

// ---------- 报告 ----------
const report = {
	generatedAt: new Date().toISOString(),
	old: OLD_ROOT,
	new: NEW_ROOT,
	count: entries.length,
	posts: entries.map((e) => ({
		from: e.rel,
		to: `src/content/posts/${e.slug}.md`,
		oldUrl: `/post/${e.oldSlug}`,
		newUrl: `/posts/${e.slug}/`,
		droppedFrontmatter: e.dropped,
	})),
	warnings,
};

if (!DRY) {
	fs.writeFileSync(path.join(NEW_ROOT, "migration-report.json"), JSON.stringify(report, null, 2), "utf8");
	fs.writeFileSync(
		path.join(NEW_ROOT, "vercel-redirects.json"),
		JSON.stringify({ redirects }, null, 2),
		"utf8",
	);
}

// ---------- 控制台摘要 ----------
console.log(`\n旧文章目录：${OLD_POSTS}`);
console.log(`新文章目录：${NEW_POSTS}`);
console.log(`处理文章：${entries.length} 篇${DRY ? "（dry-run，未写入）" : "，已写入"}`);
if (warnings.length) {
	console.log(`\n需要人工看一眼的 ${warnings.length} 项：`);
	for (const w of warnings) console.log(`  [${w.level}] ${w.file ? `${w.file}: ` : ""}${w.message}`);
}
console.log(`\n下一步：把 vercel-redirects.json 里的 redirects 合并进新仓库的 vercel.json。`);
if (!COPY_PUBLIC_IMG) console.log(`封面若用 /img/... 路径，记得加 --copy-public-img 或手动复制 public/img。`);

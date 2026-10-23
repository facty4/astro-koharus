import type { AnnouncementConfig } from "../types/config";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题
	title: "公告",

	// 公告列表（sort 越大越靠前）
	items: [
		{
			tag: "迁移",
			title: "站点已换成新主题",
			content:
				"博客从 astro-koharu 迁移到 Firefly-Mod，文章地址改为 /posts/<slug>/，旧链接会自动跳转。",
			time: "2026-10-23",
			sort: 1,
		},
	],

	// 是否允许用户关闭公告
	closable: true,
};

import type { App } from "obsidian";
import type { LatestHost } from "./BookmarkView";

export interface Bookmark {
	name: string;
	url: string;
}

export interface BookmarkFolder {
	name: string;
	bookmarks: Bookmark[];
	subfolders: BookmarkFolder[];
}

export interface BookmarkStore {
	folders: BookmarkFolder[];
	uncategorized: Bookmark[];
	recentUrls?: string[];
}

export interface FolderOption {
	label: string;
	value: string;
	isSubfolder: boolean;
}

export interface OpenTab {
	title: string;
	type: string;
	leafId: string;
}

export interface LatestFile {
	title: string;
	path: string;
	ctime: number;
	mtime: number;
}

/** Options for renderLatestSubsection(). */
export interface RenderLatestSubsectionOptions {
	app: App;
	containerEl: HTMLElement;
	collapseState: Record<string, boolean>;
	subsectionKey: string;
	label: string;
	iconName: string;
	files: LatestFile[];
	host: LatestHost;
	setCollapseState: (key: string, collapsed: boolean) => Promise<void>;
}

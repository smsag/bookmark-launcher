import { App, FuzzyMatch, FuzzySuggestModal, prepareFuzzySearch } from "obsidian";
import { Bookmark, BookmarkFolder, BookmarkStore } from "./types";
import { LaunchpadHost } from "./LaunchpadHost";
import { t } from "./i18n";

type QuickOpenItem =
	| { type: "header"; label: string }
	| { type: "separator" }
	| { type: "bookmark"; entry: BookmarkEntry; showPath: boolean };

interface BookmarkEntry {
	bookmark: Bookmark;
	folderPath: string;
}

function flattenFolder(folder: BookmarkFolder, prefix: string): BookmarkEntry[] {
	const entries: BookmarkEntry[] = [];
	for (const bm of folder.bookmarks) {
		entries.push({ bookmark: bm, folderPath: prefix });
	}
	for (const sub of folder.subfolders) {
		entries.push(...flattenFolder(sub, `${prefix} / ${sub.name}`));
	}
	return entries;
}

function flattenStore(store: BookmarkStore): BookmarkEntry[] {
	const entries: BookmarkEntry[] = [];
	for (const folder of store.folders) {
		entries.push(...flattenFolder(folder, folder.name));
	}
	for (const bm of store.uncategorized) {
		entries.push({ bookmark: bm, folderPath: "" });
	}
	return entries;
}

const EMPTY_MATCH = { score: 0, matches: [] };

export class BookmarkQuickOpenModal extends FuzzySuggestModal<QuickOpenItem> {
	private store: BookmarkStore;
	private allEntries: BookmarkEntry[];
	private recentUrls: string[];
	private host: LaunchpadHost;

	constructor(app: App, store: BookmarkStore, recentUrls: string[], host: LaunchpadHost) {
		super(app);
		this.host = host;
		this.store = store;
		this.recentUrls = recentUrls;
		this.allEntries = flattenStore(store);
		this.setPlaceholder(t("quickOpen.placeholder"));
	}

	getSuggestions(query: string): FuzzyMatch<QuickOpenItem>[] {
		if (!query) {
			return this.buildCategorizedList();
		}
		const search = prepareFuzzySearch(query);
		const results: FuzzyMatch<QuickOpenItem>[] = [];
		for (const entry of this.allEntries) {
			const match = search(entry.bookmark.name);
			if (match) results.push({ item: { type: "bookmark", entry, showPath: true }, match });
		}
		return results.sort((a, b) => b.match.score - a.match.score);
	}

	private buildCategorizedList(): FuzzyMatch<QuickOpenItem>[] {
		const items: FuzzyMatch<QuickOpenItem>[] = [];

		const push = (item: QuickOpenItem) =>
			items.push({ item, match: EMPTY_MATCH });

		// Recent section
		const recentEntries = this.recentUrls
			.map(url => this.allEntries.find(e => e.bookmark.url === url))
			.filter((e): e is BookmarkEntry => e !== undefined);
		if (recentEntries.length > 0) {
			push({ type: "header", label: t("quickOpen.sectionRecent") });
			for (const entry of recentEntries) {
				push({ type: "bookmark", entry, showPath: true });
			}
			push({ type: "separator" });
		}

		// Bookmarks section
		push({ type: "header", label: t("quickOpen.sectionBookmarks") });

		const pushFolderTree = (folder: BookmarkFolder, parentLabel: string) => {
			const label = parentLabel ? `${parentLabel} / ${folder.name}` : folder.name;
			push({ type: "header", label });
			for (const bm of folder.bookmarks) {
				push({ type: "bookmark", entry: { bookmark: bm, folderPath: label }, showPath: false });
			}
			for (const sub of folder.subfolders) {
				pushFolderTree(sub, label);
			}
		};

		for (const folder of this.store.folders) {
			pushFolderTree(folder, "");
		}

		if (this.store.uncategorized.length > 0) {
			for (const bm of this.store.uncategorized) {
				push({ type: "bookmark", entry: { bookmark: bm, folderPath: "" }, showPath: false });
			}
		}

		return items;
	}

	// Required by FuzzySuggestModal — not called since getSuggestions is overridden.
	getItems(): QuickOpenItem[] { return []; }
	getItemText(item: QuickOpenItem): string {
		return item.type === "bookmark" ? item.entry.bookmark.name : "";
	}

	renderSuggestion(match: FuzzyMatch<QuickOpenItem>, el: HTMLElement): void {
		const { item } = match;
		if (item.type === "separator") {
			el.createEl("div", { cls: "lp-qo-separator" });
			return;
		}
		if (item.type === "header") {
			el.createEl("div", { text: item.label, cls: "lp-qo-header" });
			return;
		}
		const wrapper = el.createEl("div", { cls: "lp-qo-bookmark" });
		wrapper.createEl("div", { text: item.entry.bookmark.name, cls: "lp-qo-name" });
		if (item.showPath && item.entry.folderPath) {
			wrapper.createEl("div", { text: item.entry.folderPath, cls: "lp-qo-meta" });
		}
	}

	onChooseItem(item: QuickOpenItem): void {
		if (item.type !== "bookmark") return;
		this.host.openBookmarkUrl(item.entry.bookmark.url);
		this.host.recordRecentBookmark(item.entry.bookmark.url);
	}
}

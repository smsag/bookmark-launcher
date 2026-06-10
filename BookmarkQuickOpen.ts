import { App, FuzzyMatch, FuzzySuggestModal, prepareFuzzySearch } from "obsidian";
import { Bookmark, BookmarkFolder, BookmarkStore } from "./types";
import { LaunchpadHost } from "./LaunchpadHost";
import { t } from "./i18n";

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
		entries.push(...flattenFolder(sub, `${prefix} › ${sub.name}`));
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

export class BookmarkQuickOpenModal extends FuzzySuggestModal<BookmarkEntry> {
	private allEntries: BookmarkEntry[];
	private recentUrls: string[];
	private host: LaunchpadHost;

	constructor(app: App, store: BookmarkStore, recentUrls: string[], host: LaunchpadHost) {
		super(app);
		this.host = host;
		this.recentUrls = recentUrls;
		this.allEntries = flattenStore(store);
		this.setPlaceholder(t("quickOpen.placeholder"));
	}

	getSuggestions(query: string): FuzzyMatch<BookmarkEntry>[] {
		if (!query) {
			return this.recentUrls
				.map(url => this.allEntries.find(e => e.bookmark.url === url))
				.filter((e): e is BookmarkEntry => e !== undefined)
				.map(item => ({ item, match: { score: 0, matches: [] } }));
		}
		const search = prepareFuzzySearch(query);
		const results: FuzzyMatch<BookmarkEntry>[] = [];
		for (const item of this.allEntries) {
			const match = search(item.bookmark.name);
			if (match) results.push({ item, match });
		}
		return results.sort((a, b) => b.match.score - a.match.score);
	}

	// Required by FuzzySuggestModal but unused — getSuggestions is overridden.
	getItems(): BookmarkEntry[] { return this.allEntries; }
	getItemText(entry: BookmarkEntry): string { return entry.bookmark.name; }

	renderSuggestion(match: FuzzyMatch<BookmarkEntry>, el: HTMLElement): void {
		const { item } = match;
		el.createEl("div", { text: item.bookmark.name, cls: "lp-qo-name" });
		if (item.folderPath) el.createEl("div", { text: item.folderPath, cls: "lp-qo-meta" });
	}

	onChooseItem(entry: BookmarkEntry): void {
		this.host.openBookmarkUrl(entry.bookmark.url);
		this.host.recordRecentBookmark(entry.bookmark.url);
	}
}

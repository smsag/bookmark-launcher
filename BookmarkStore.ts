import { App, TFile } from "obsidian";
import { Bookmark, BookmarkFolder, BookmarkStore, FolderOption } from "./types";

export const BOOKMARKS_FILE = "bookmarks.md";

const BOOKMARK_RE = /^\s*-\s+\[([^\]]+)\]\(([^)]+)\)\s*$/;

export class BookmarkStoreManager {
	private app: App;
	private writing = false;

	constructor(app: App) {
		this.app = app;
	}

	private async getFile(): Promise<TFile | null> {
		const f = this.app.vault.getAbstractFileByPath(BOOKMARKS_FILE);
		return f instanceof TFile ? f : null;
	}

	private async ensureFile(): Promise<TFile> {
		let f = await this.getFile();
		if (!f) {
			await this.app.vault.create(BOOKMARKS_FILE, "");
			f = await this.getFile();
		}
		return f!;
	}

	async parse(): Promise<BookmarkStore> {
		const f = await this.getFile();
		if (!f) return { folders: [], uncategorized: [] };
		const content = await this.app.vault.read(f);
		return this.parseContent(content);
	}

	parseContent(content: string): BookmarkStore {
		const lines = content.split("\n");
		const store: BookmarkStore = { folders: [], uncategorized: [] };
		let currentFolder: BookmarkFolder | null = null;
		let currentSubfolder: BookmarkFolder | null = null;

		for (const line of lines) {
			if (line.startsWith("## ")) {
				const name = line.slice(3).trim();
				if (currentFolder) {
					currentSubfolder = { name, bookmarks: [], subfolders: [] };
					currentFolder.subfolders.push(currentSubfolder);
				}
			} else if (line.startsWith("# ")) {
				const name = line.slice(2).trim();
				currentSubfolder = null;
				currentFolder = { name, bookmarks: [], subfolders: [] };
				store.folders.push(currentFolder);
			} else {
				const m = line.match(BOOKMARK_RE);
				if (m) {
					const bm: Bookmark = { name: m[1], url: m[2] };
					if (currentSubfolder) {
						currentSubfolder.bookmarks.push(bm);
					} else if (currentFolder) {
						currentFolder.bookmarks.push(bm);
					} else {
						store.uncategorized.push(bm);
					}
				}
			}
		}
		return store;
	}

	serialize(store: BookmarkStore): string {
		const parts: string[] = [];

		if (store.uncategorized.length > 0) {
			for (const bm of store.uncategorized) {
				parts.push(`- [${bm.name}](${bm.url})`);
			}
		}

		for (const folder of store.folders) {
			if (parts.length > 0) parts.push("");
			parts.push(`# ${folder.name}`);
			for (const bm of folder.bookmarks) {
				parts.push(`- [${bm.name}](${bm.url})`);
			}
			for (const sub of folder.subfolders) {
				parts.push("");
				parts.push(`## ${sub.name}`);
				for (const bm of sub.bookmarks) {
					parts.push(`- [${bm.name}](${bm.url})`);
				}
			}
		}

		return parts.join("\n");
	}

	getFolderOptions(store: BookmarkStore): FolderOption[] {
		const opts: FolderOption[] = [];
		for (const folder of store.folders) {
			opts.push({ label: folder.name, value: folder.name, isSubfolder: false });
			for (const sub of folder.subfolders) {
				opts.push({
					label: `  ${sub.name}`,
					value: sub.name,
					isSubfolder: true,
				});
			}
		}
		return opts;
	}

	async addBookmark(
		bookmark: Bookmark,
		targetFolderName: string,
		isNewFolder: boolean
	): Promise<void> {
		if (this.writing) return;
		this.writing = true;
		try {
			const f = await this.ensureFile();
			// Re-read before writing to respect external edits
			const content = await this.app.vault.read(f);
			const store = this.parseContent(content);

			if (isNewFolder) {
				store.folders.push({
					name: targetFolderName,
					bookmarks: [bookmark],
					subfolders: [],
				});
			} else if (!targetFolderName) {
				store.uncategorized.push(bookmark);
			} else {
				let added = false;
				for (const folder of store.folders) {
					if (folder.name === targetFolderName) {
						folder.bookmarks.push(bookmark);
						added = true;
						break;
					}
					for (const sub of folder.subfolders) {
						if (sub.name === targetFolderName) {
							sub.bookmarks.push(bookmark);
							added = true;
							break;
						}
					}
					if (added) break;
				}
				if (!added) {
					store.folders.push({
						name: targetFolderName,
						bookmarks: [bookmark],
						subfolders: [],
					});
				}
			}

			await this.app.vault.modify(f, this.serialize(store));
		} finally {
			this.writing = false;
		}
	}
}

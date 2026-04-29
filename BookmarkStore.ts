import { App, TFile, TFolder } from "obsidian";
import { Bookmark, BookmarkFolder, BookmarkStore, FolderOption } from "./types";

export const DEFAULT_BOOKMARKS_FILE = "bookmarks.md";

const BOOKMARK_RE = /^\s*-\s+\[([^\]]+)\]\(([^)]+)\)\s*$/;

// Schemes that are safe to open. Anything else (javascript:, data:, file:, …)
// is silently dropped at parse time so it never reaches the view layer.
const ALLOWED_SCHEMES = ["https://", "http://", "obsidian://"];

export class BookmarkStoreManager {
	private app: App;
	private filePath: string;
	private writing = false;

	constructor(app: App, filePath: string = DEFAULT_BOOKMARKS_FILE) {
		this.app = app;
		this.filePath = filePath;
	}

	getFilePath(): string {
		return this.filePath;
	}

	setFilePath(path: string): void {
		this.filePath = path;
	}

	private getFile(): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.filePath);
		return f instanceof TFile ? f : null;
	}

	/** Creates any missing parent folders for this.filePath. */
	private async ensureParentFolders(): Promise<void> {
		const segments = this.filePath.split("/");
		segments.pop(); // drop the filename
		if (segments.length === 0) return;

		let current = "";
		for (const seg of segments) {
			current = current ? `${current}/${seg}` : seg;
			const node = this.app.vault.getAbstractFileByPath(current);
			if (!node) {
				try {
					await this.app.vault.createFolder(current);
				} catch {
					// May have been created concurrently — ignore
				}
			}
		}
	}

	async ensureFile(): Promise<TFile> {
		let f = this.getFile();
		if (!f) {
			await this.ensureParentFolders();
			await this.app.vault.create(this.filePath, "");
			f = this.getFile();
		}
		return f!;
	}

	async parse(): Promise<BookmarkStore> {
		const f = this.getFile();
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
					const parsedUrl = m[2];
					// Drop bookmarks whose URL scheme is not explicitly allowed.
					// This is a defence-in-depth guard: the modal validates on
					// input, but bookmarks.md is a plain file anyone (or any
					// plugin) can write directly.
					if (!ALLOWED_SCHEMES.some((s) => parsedUrl.startsWith(s))) {
						continue;
					}
					const bm: Bookmark = { name: m[1], url: parsedUrl };
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

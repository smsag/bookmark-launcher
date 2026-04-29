import { App, TFile, TFolder } from "obsidian";
import { Bookmark, BookmarkFolder, BookmarkStore, FolderOption } from "./types";

export const DEFAULT_BOOKMARKS_FILE = "bookmarks.md";

const BOOKMARK_RE = /^\s*-\s+\[([^\]]+)\]\(([^)]+)\)\s*$/;

// Schemes that are safe to open. Anything else (javascript:, data:, file:, …)
// is silently dropped at parse time so it never reaches the view layer.
const ALLOWED_SCHEMES = ["https://", "http://", "obsidian://"];

// Separator used in composite folder option values (e.g. "Work\x1FDesign").
// ASCII Unit Separator (U+001F) cannot appear in user-typed text, so it
// unambiguously separates parent and child folder names even when those
// names themselves contain slashes or other punctuation.
export const FOLDER_SEP = "\x1F";

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
			// BUG-2 fix: vault.create is async but getAbstractFileByPath reads
			// from an in-memory index that Obsidian updates synchronously when
			// create resolves. If it is somehow still null, fail loudly so the
			// caller gets a clear error instead of a runtime crash deep in
			// vault.read(null).
			if (!f) {
				throw new Error(
					`Bookmark Launcher: failed to create "${this.filePath}". ` +
					`Check that the path is valid and the vault is writable.`
				);
			}
		}
		return f;
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
				} else {
					// BUG-8 fix: orphaned ## with no preceding # — treat as a
					// top-level folder so bookmarks beneath it are not silently
					// dropped into uncategorized.
					currentSubfolder = null;
					currentFolder = { name, bookmarks: [], subfolders: [] };
					store.folders.push(currentFolder);
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

		// BUG-10 fix: always end with a newline so external editors that add
		// one don't produce a perpetually dirty file on every plugin write.
		return parts.join("\n") + "\n";
	}

	getFolderOptions(store: BookmarkStore): FolderOption[] {
		const opts: FolderOption[] = [];
		for (const folder of store.folders) {
			opts.push({ label: folder.name, value: folder.name, isSubfolder: false });
			for (const sub of folder.subfolders) {
				// BUG-7 fix: use a composite "parent\x1Fchild" value so that
				// addBookmark can locate the exact subfolder even when two
				// different top-level folders share a subfolder of the same name.
				opts.push({
					label: `  ${sub.name}`,
					value: `${folder.name}${FOLDER_SEP}${sub.name}`,
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

				// BUG-7 fix: composite subfolder key ("parent\x1Fchild") lets
				// us find the precise subfolder without ambiguity.
				const sepIdx = targetFolderName.indexOf(FOLDER_SEP);
				if (sepIdx !== -1) {
					const parentName = targetFolderName.slice(0, sepIdx);
					const subName = targetFolderName.slice(sepIdx + 1);
					for (const folder of store.folders) {
						if (folder.name === parentName) {
							const sub = folder.subfolders.find(
								(s) => s.name === subName
							);
							if (sub) {
								sub.bookmarks.push(bookmark);
								added = true;
							}
							break;
						}
					}
				} else {
					for (const folder of store.folders) {
						if (folder.name === targetFolderName) {
							folder.bookmarks.push(bookmark);
							added = true;
							break;
						}
					}
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

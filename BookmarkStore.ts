import { App, TFile, TFolder } from "obsidian";
import { Bookmark, BookmarkFolder, BookmarkStore, FolderOption } from "./types";

export const DEFAULT_BOOKMARKS_FILE = "bookmarks.md";

// Lazy name (.+?) stops at the first `](` sequence; greedy URL (.+) captures
// everything up to the last `)` before end-of-line. This correctly handles:
//   • URLs that contain parentheses (e.g. Wikipedia, query strings)
//   • Names that contain `]` (e.g. "Stack Overflow [closed]")
const BOOKMARK_RE = /^\s*-\s+\[(.+?)\]\((.+)\)\s*$/;

// Schemes that are safe to open. Anything else (javascript:, data:, file:, …)
// is silently dropped at parse time so it never reaches the view layer.
const ALLOWED_SCHEMES = ["https://", "http://", "obsidian://", "vault://", "note://"];

// Separator used in composite folder option values (e.g. "Work\x1FDesign").
// ASCII Unit Separator (U+001F) cannot appear in user-typed text, so it
// unambiguously separates parent and child folder names even when those
// names themselves contain slashes or other punctuation.
export const FOLDER_SEP = "\x1F";

function stripCtrl(s: string): string {
	return s.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

export class BookmarkStoreManager {
	private app: App;
	private filePath: string;

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
		const dirs = this.filePath.split("/").slice(0, -1);
		if (dirs.length === 0) return;

		let current = "";
		for (const seg of dirs) {
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
		// vault.read() returns "" (not a throw) when iCloud hasn't hydrated the
		// file yet. Treat an unexpectedly empty file as a read failure so the
		// exponential-backoff retry in refreshViews() kicks in.
		if (content === "" && f.stat.size > 0) {
			throw new Error(
				`Launchpad: empty read for "${this.filePath}" (size=${f.stat.size}) — likely iCloud not yet hydrated`
			);
		}
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
					// Orphaned ## with no preceding # — treat as top-level.
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
					// Defence-in-depth: drop disallowed schemes even if they
					// bypass the modal (bookmarks.md is a plain, editable file).
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

		// Always end with a newline to avoid a dirty-file cycle with editors
		// that append one on save.
		return parts.join("\n") + "\n";
	}

	getFolderOptions(store: BookmarkStore): FolderOption[] {
		const opts: FolderOption[] = [];
		for (const folder of store.folders) {
			opts.push({ label: folder.name, value: folder.name, isSubfolder: false });
			for (const sub of folder.subfolders) {
				// Composite "parent\x1Fchild" value disambiguates subfolders that
				// share a name across different top-level folders.
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
		// Sanitize at the write boundary: strip control characters that could
		// inject extra Markdown structure into bookmarks.md when serialized.
		bookmark = { name: stripCtrl(bookmark.name), url: bookmark.url.replace(/[\x00-\x1f\x7f]/g, "").trim() };
		targetFolderName = stripCtrl(targetFolderName);

		const f = await this.ensureFile();
		await this.app.vault.process(f, (content) => {
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

			return this.serialize(store);
		});
	}
}

import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { BookmarkStoreManager, DEFAULT_BOOKMARKS_FILE } from "./BookmarkStore";
import { BookmarkView, BookmarkViewHost, VIEW_TYPE_BOOKMARK } from "./BookmarkView";
import { CaptureModal } from "./CaptureModal";
import { SetupModal } from "./SetupModal";

interface PluginData {
	collapseState: Record<string, boolean>;
	/** Vault-relative path to the bookmarks file. Null = not yet configured. */
	bookmarksFilePath: string | null;
}

const DEFAULT_DATA: PluginData = {
	collapseState: {},
	bookmarksFilePath: null,
};

export default class LaunchpadPlugin
	extends Plugin
	implements BookmarkViewHost
{
	store!: BookmarkStoreManager;
	private data!: PluginData;
	/** File that was active immediately before an obsidian:// bookmark click. */
	private previousFile: TFile | null = null;
	/** Pending exponential-backoff retry for refreshViews when iCloud read fails. */
	private refreshRetryTimer: number | null = null;

	async onload(): Promise<void> {
		this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

		// Initialise the store with whatever path we have so far (may be null →
		// falls back to the default constant; we'll update it after setup).
		this.store = new BookmarkStoreManager(
			this.app,
			this.data.bookmarksFilePath ?? DEFAULT_BOOKMARKS_FILE
		);

		this.registerView(VIEW_TYPE_BOOKMARK, (leaf) => new BookmarkView(leaf, this));

		this.addRibbonIcon("bookmark", "Launchpad", () => this.revealPanel());

		this.addCommand({
			id: "add-bookmark",
			name: "Add bookmark",
			callback: () => this.openCaptureModal(),
		});

		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => this.revealPanel(),
		});

		this.addCommand({
			id: "configure-file",
			name: "Configure bookmarks file location",
			callback: () => this.showSetupModal(),
		});

		// Re-render sidebar whenever the bookmarks file changes.
		const onBookmarksFileChange = (file: TAbstractFile) => {
			if (file instanceof TFile && file.path === this.store.getFilePath())
				this.refreshViews();
		};
		this.registerEvent(this.app.vault.on("modify", onBookmarksFileChange));
		this.registerEvent(this.app.vault.on("create", onBookmarksFileChange));

		// iCloud can replace a stub with the real file via a rename, which
		// modify/create watchers would miss.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const path = this.store.getFilePath();
				if (file instanceof TFile && (file.path === path || oldPath === path)) {
					this.refreshViews();
				}
			})
		);

		// Add "Copy path for Launchpad" to the folder context menu, grouped
		// with Obsidian's native "Copy path" item (section "info").
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFolder)) return;
				const launchpadPath =
					"vault://" + file.path.split("/").map(encodeURIComponent).join("/");
				menu.addItem((item) =>
					item
						.setTitle("Copy path for Launchpad")
						.setIcon("copy")
						.setSection("info")
						.onClick(() => navigator.clipboard.writeText(launchpadPath))
				);
			})
		);

		this.app.workspace.onLayoutReady(() => this.initOnReady());
	}

	async onunload(): Promise<void> {
		if (this.refreshRetryTimer !== null) {
			window.clearTimeout(this.refreshRetryTimer);
			this.refreshRetryTimer = null;
		}
	}

	// ── Startup ────────────────────────────────────────────────────────────

	private async initOnReady(): Promise<void> {
		if (this.data.bookmarksFilePath) {
			await this.openAndRefresh();
			return;
		}

		// No path stored yet — check for a legacy bookmarks.md at the vault root
		// (users upgrading from v0.1.0). Silently adopt it to avoid interruption.
		const legacyFile = this.app.vault.getAbstractFileByPath(DEFAULT_BOOKMARKS_FILE);
		if (legacyFile instanceof TFile) {
			await this.adoptPath(DEFAULT_BOOKMARKS_FILE);
			await this.openAndRefresh();
			return;
		}

		// Genuinely first launch — ask the user where they want the file.
		this.showSetupModal();
	}

	/** Ensures the sidebar panel is open and populated. */
	private async openAndRefresh(): Promise<void> {
		await this.ensurePanelOpen();
		await this.refreshViews();
	}

	/** Adds the panel to the right sidebar if it is not already there. */
	private async ensurePanelOpen(): Promise<void> {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK).length > 0) {
			return; // Already present — Obsidian restored it from workspace state.
		}
		// getRightLeaf(false) returns null on iOS single-pane layouts because no
		// right-sidebar split exists yet at startup. getRightLeaf(true) creates
		// one, matching how core panels (Backlinks, etc.) behave on mobile.
		const leaf = this.app.workspace.getRightLeaf(false)
			?? this.app.workspace.getRightLeaf(true);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_BOOKMARK, active: true });
	}

	// ── Setup modal ────────────────────────────────────────────────────────

	showSetupModal(): void {
		new SetupModal(this.app, async (chosenPath: string) => {
			await this.adoptPath(chosenPath);
			await this.store.ensureFile();
			await this.revealPanel();
		}).open();
	}

	/** Persist a confirmed bookmarks file path and point the store at it. */
	private async adoptPath(path: string): Promise<void> {
		this.data.bookmarksFilePath = path;
		await this.saveData(this.data);
		this.store.setFilePath(path);
	}

	// ── BookmarkViewHost ───────────────────────────────────────────────────

	async openCaptureModal(): Promise<void> {
		const storeData = await this.store.parse();
		const folderOptions = this.store.getFolderOptions(storeData);
		new CaptureModal(this.app, this.store, folderOptions).open();
	}

	getCollapseState(): Record<string, boolean> {
		return this.data.collapseState;
	}

	async setCollapseState(key: string, collapsed: boolean): Promise<void> {
		this.data.collapseState[key] = collapsed;
		await this.saveData(this.data);
	}

	openBookmarkUrl(url: string): void {
		// Allowlist URL schemes — reject anything not explicitly safe.
		// bookmarks.md is user-editable plain text; without this guard a
		// javascript: URI would execute in Obsidian's Electron renderer.

		// Shared pre-flight: reject any URL containing control characters
		// (including newlines / null bytes). These can corrupt window.open
		// behaviour in some Electron versions regardless of scheme.
		if (/[\x00-\x1f\x7f]/.test(url)) {
			new Notice("Launchpad: URL contains invalid characters and was not opened.");
			return;
		}

		if (url.startsWith("vault://")) {
			const folderPath = decodeURIComponent(url.slice("vault://".length));
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				new Notice(`Launchpad: folder not found — ${folderPath}`);
				return;
			}
			const leaves = this.app.workspace.getLeavesOfType("file-explorer");
			if (leaves.length > 0) {
				try {
					this.app.workspace.revealLeaf(leaves[0]);
					const view = leaves[0].view as any;
					if (typeof view.revealInFolder === "function") {
						view.revealInFolder(folder);
						return;
					}
				} catch {
					// fall through to Notice
				}
			}
			// Mobile (no file-explorer leaf) or internal API renamed/removed.
			new Notice(`Launchpad: ${folderPath}`);
		} else if (url.startsWith("note://")) {
			const notePath = url.slice("note://".length);
			const file = this.app.metadataCache.getFirstLinkpathDest(notePath, "");
			if (!file) {
				new Notice(`Launchpad: note not found — ${notePath}`);
				return;
			}
			this.app.workspace.getLeaf(false).openFile(file);
		} else if (url.startsWith("obsidian://")) {
			this.previousFile = this.app.workspace.getActiveFile();
			window.open(url);
			this.refreshViews();
		} else if (url.startsWith("https://") || url.startsWith("http://")) {
			window.open(url, "_blank", "noopener,noreferrer");
		}
		// Any other scheme (javascript:, file:, data:, …) is silently ignored.
	}

	getPreviousFilename(): string | null {
		return this.previousFile?.basename ?? null;
	}

	async navigateBack(): Promise<void> {
		const file = this.previousFile;
		if (!file) return;
		// Clear before navigating so the back link is gone on re-render.
		this.previousFile = null;
		// Guard: file may have been deleted between capture and click.
		if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
			await this.refreshViews();
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
		await this.refreshViews();
	}

	// ── Panel management ───────────────────────────────────────────────────

	async revealPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK);
		if (existing.length > 0) {
			const leaf = existing[0];
			// setActiveLeaf switches the visible tab within the sidebar tab group.
			// revealLeaf then expands the sidebar if it is currently collapsed.
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
			this.app.workspace.revealLeaf(leaf);
		} else {
			// No existing leaf — create one. getRightLeaf(false) returns null on
			// iOS single-pane layouts; fall back to getRightLeaf(true) which
			// creates a new split rather than requiring one to already exist.
			const leaf = this.app.workspace.getRightLeaf(false)
				?? this.app.workspace.getRightLeaf(true);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_BOOKMARK, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
		// Always refresh after revealing so callers don't need a separate
		// refreshViews() call (which caused two concurrent vault.read calls).
		await this.refreshViews();
	}

	private async refreshViews(retryCount = 0): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK);
		if (leaves.length === 0) return;
		let storeData;
		try {
			storeData = await this.store.parse();
		} catch {
			// File not yet readable (e.g. iCloud stub not yet downloaded on iOS).
			// vault modify/create events don't fire when iCloud hydrates a stub,
			// so retry with exponential backoff (6 attempts, ~63 s total).
			if (retryCount < 6) {
				this.refreshRetryTimer = window.setTimeout(
					() => this.refreshViews(retryCount + 1),
					1000 * Math.pow(2, retryCount)
				);
			}
			return;
		}
		// Successful read — cancel any pending retry.
		if (this.refreshRetryTimer !== null) {
			window.clearTimeout(this.refreshRetryTimer);
			this.refreshRetryTimer = null;
		}
		for (const leaf of leaves) {
			if (leaf.view instanceof BookmarkView) {
				leaf.view.setStore(storeData);
			}
		}
	}
}

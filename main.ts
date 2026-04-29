import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
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

export default class BookmarkLauncherPlugin
	extends Plugin
	implements BookmarkViewHost
{
	store!: BookmarkStoreManager;
	private data!: PluginData;

	async onload(): Promise<void> {
		this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

		// Initialise the store with whatever path we have so far (may be null →
		// falls back to the default constant; we'll update it after setup).
		this.store = new BookmarkStoreManager(
			this.app,
			this.data.bookmarksFilePath ?? DEFAULT_BOOKMARKS_FILE
		);

		this.registerView(VIEW_TYPE_BOOKMARK, (leaf) => new BookmarkView(leaf, this));

		this.addRibbonIcon("bookmark", "Bookmark Launcher", () => this.revealPanel());

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
		// We read this.store.getFilePath() at event time so it always tracks the
		// current path even if the user reconfigures it mid-session.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.path === this.store.getFilePath()) {
					this.refreshViews();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.path === this.store.getFilePath()) {
					this.refreshViews();
				}
			})
		);

		this.app.workspace.onLayoutReady(() => this.initOnReady());
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKMARK);
	}

	// ── Startup ────────────────────────────────────────────────────────────

	private async initOnReady(): Promise<void> {
		if (this.data.bookmarksFilePath) {
			// Path already configured — go straight to rendering.
			await this.refreshViews();
			return;
		}

		// No path stored yet. Check whether bookmarks.md already exists at the
		// vault root (e.g. user is upgrading from v0.1.0 which always used that
		// path). If so, silently adopt it so existing users aren't interrupted.
		const legacyFile = this.app.vault.getAbstractFileByPath(DEFAULT_BOOKMARKS_FILE);
		if (legacyFile instanceof TFile) {
			await this.adoptPath(DEFAULT_BOOKMARKS_FILE);
			await this.refreshViews();
			return;
		}

		// Genuinely first launch — ask the user where they want the file.
		this.showSetupModal();
	}

	// ── Setup modal ────────────────────────────────────────────────────────

	showSetupModal(): void {
		new SetupModal(this.app, async (chosenPath: string) => {
			await this.adoptPath(chosenPath);
			await this.store.ensureFile();
			await this.refreshViews();
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

	openCaptureModal(): void {
		this.store.parse().then((storeData) => {
			const folderOptions = this.store.getFolderOptions(storeData);
			new CaptureModal(this.app, this.store, folderOptions).open();
		});
	}

	getCollapseState(): Record<string, boolean> {
		return this.data.collapseState;
	}

	async setCollapseState(key: string, collapsed: boolean): Promise<void> {
		this.data.collapseState[key] = collapsed;
		await this.saveData(this.data);
	}

	// ── Panel management ───────────────────────────────────────────────────

	async revealPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false) as WorkspaceLeaf;
		await leaf.setViewState({ type: VIEW_TYPE_BOOKMARK, active: true });
		this.app.workspace.revealLeaf(leaf);
		await this.refreshViews();
	}

	private async refreshViews(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK);
		if (leaves.length === 0) return;
		const storeData = await this.store.parse();
		for (const leaf of leaves) {
			if (leaf.view instanceof BookmarkView) {
				leaf.view.setStore(storeData);
			}
		}
	}
}

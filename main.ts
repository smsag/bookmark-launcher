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
			// Path already configured — ensure the panel is visible in the
			// right sidebar and then populate it with the current store.
			// refreshViews() alone is not enough: it bails early when no leaf
			// exists, and onunload() removes the leaf before Obsidian writes
			// workspace.json, so there is nothing for Obsidian to restore on
			// the next launch. ensurePanelOpen() guarantees the leaf is always
			// present after startup, matching the behaviour of core panels like
			// Backlinks and Outgoing Links.
			await this.ensurePanelOpen();
			await this.refreshViews();
			return;
		}

		// No path stored yet. Check whether bookmarks.md already exists at the
		// vault root (e.g. user is upgrading from v0.1.0 which always used that
		// path). If so, silently adopt it so existing users aren't interrupted.
		const legacyFile = this.app.vault.getAbstractFileByPath(DEFAULT_BOOKMARKS_FILE);
		if (legacyFile instanceof TFile) {
			await this.adoptPath(DEFAULT_BOOKMARKS_FILE);
			await this.ensurePanelOpen();
			await this.refreshViews();
			return;
		}

		// Genuinely first launch — ask the user where they want the file.
		this.showSetupModal();
	}

	/** Adds the panel to the right sidebar if it is not already there. */
	private async ensurePanelOpen(): Promise<void> {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK).length > 0) {
			return; // Already present — Obsidian restored it from workspace state.
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_BOOKMARK, active: true });
	}

	// ── Setup modal ────────────────────────────────────────────────────────

	showSetupModal(): void {
		new SetupModal(this.app, async (chosenPath: string) => {
			await this.adoptPath(chosenPath);
			await this.store.ensureFile();
			// BUG-4 fix: revealPanel now always calls refreshViews, so we don't
			// need an explicit call here — doing both caused two concurrent
			// vault.read calls in undefined completion order.
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
			const leaf = existing[0];
			// setActiveLeaf switches the visible tab within the sidebar tab group.
			// revealLeaf then expands the sidebar if it is currently collapsed.
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
			this.app.workspace.revealLeaf(leaf);
		} else {
			// No existing leaf — create one. getRightLeaf can return null on
			// single-pane layouts (e.g. mobile), so guard before using it.
			const leaf = this.app.workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_BOOKMARK, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
		// BUG-4 fix: always refresh after revealing so callers (e.g. the setup
		// modal callback) don't need a separate refreshViews() call — which
		// previously caused two concurrent vault.read calls in undefined order.
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

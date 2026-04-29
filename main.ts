import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { BookmarkStoreManager, BOOKMARKS_FILE } from "./BookmarkStore";
import { BookmarkView, BookmarkViewHost, VIEW_TYPE_BOOKMARK } from "./BookmarkView";
import { CaptureModal } from "./CaptureModal";

interface PluginData {
	collapseState: Record<string, boolean>;
}

const DEFAULT_DATA: PluginData = {
	collapseState: {},
};

export default class BookmarkLauncherPlugin
	extends Plugin
	implements BookmarkViewHost
{
	store!: BookmarkStoreManager;
	private data!: PluginData;

	async onload(): Promise<void> {
		this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
		this.store = new BookmarkStoreManager(this.app);

		this.registerView(VIEW_TYPE_BOOKMARK, (leaf) => new BookmarkView(leaf, this));

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

		// Re-render sidebar whenever bookmarks.md changes
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.path === BOOKMARKS_FILE) {
					this.refreshViews();
				}
			})
		);

		// Also refresh when the file is created (first save)
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.path === BOOKMARKS_FILE) {
					this.refreshViews();
				}
			})
		);

		this.app.workspace.onLayoutReady(() => this.refreshViews());
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKMARK);
	}

	// BookmarkViewHost implementation

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

	// Panel management

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

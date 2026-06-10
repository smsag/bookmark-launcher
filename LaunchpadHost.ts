import { App, Notice, TFile, TFolder } from "obsidian";
import { BookmarkStoreManager } from "./BookmarkStore";
import { BookmarkViewHost, VIEW_TYPE_BOOKMARK } from "./BookmarkView";
import { BookmarkStore, LatestFile, OpenTab } from "./types";
import { CaptureModal } from "./CaptureModal";
import { SetupModal } from "./SetupModal";
import { BookmarkQuickOpenModal } from "./BookmarkQuickOpen";

interface FileExplorerViewLike {
	revealInFolder?: (folder: TFolder) => void;
}

interface WorkspaceLeafWithRoot {
	id?: string;
	getRoot?: () => unknown;
	view: {
		getViewType(): string;
		getDisplayText(): string;
	};
}

interface AppSettingsApi {
	open: () => void;
	openTabById: (id: string) => void;
}

export interface LaunchpadHostDeps {
	app: App;
	store: BookmarkStoreManager;
	manifestId: string;
	getSettings: () => LaunchpadHostSettings;
	saveSettings: () => Promise<void>;
	refreshViews: () => Promise<void>;
	revealPanel: () => Promise<void>;
	getCollapseStateRecord: () => Record<string, boolean>;
	setCollapseStateRecord: (key: string, collapsed: boolean) => void;
	getRecentBookmarkUrls: () => string[];
	recordRecentBookmark: (url: string) => void;
}

export interface LaunchpadHostSettings {
	latestFilesCount: number;
	latestDeleteEnabled: boolean;
	tabsSectionEnabled: boolean;
	latestSectionEnabled: boolean;
	latestExcludedFiles: string;
	bookmarksFilePath: string | null;
}

/** Implements BookmarkViewHost on behalf of LaunchpadPlugin. */
export class LaunchpadHost implements BookmarkViewHost {
	private deps: LaunchpadHostDeps;
	private previousFile: TFile | null = null;
	private excludedPathsCache: Set<string> | null = null;
	private latestFilesSnapshotCache: LatestFile[] | null = null;
	private latestFilesSnapshotReuseCount = 0;
	private lastKnownStore: BookmarkStore | null = null;

	constructor(deps: LaunchpadHostDeps) {
		this.deps = deps;
	}

	/** Invalidates the excluded paths cache. Call when latestExcludedFiles changes. */
	invalidateExcludedPathsCache(): void {
		this.excludedPathsCache = null;
	}

	/** Updates the last known store snapshot. Called by refreshViews after parse. */
	setLastKnownStore(store: BookmarkStore): void {
		this.lastKnownStore = store;
	}

	getCollapseState(): Record<string, boolean> {
		return this.deps.getCollapseStateRecord();
	}

	async setCollapseState(key: string, collapsed: boolean): Promise<void> {
		this.deps.setCollapseStateRecord(key, collapsed);
	}

	async openCaptureModal(): Promise<void> {
		const storeData = this.lastKnownStore ?? await this.deps.store.parse();
		new CaptureModal(
			this.deps.app,
			this.deps.store,
			() => this.deps.store.getFolderOptions(storeData)
		).open();
	}

	openSetupModal(): void {
		new SetupModal(
			this.deps.app,
			async (chosenPath: string) => {
				this.deps.getSettings().bookmarksFilePath = chosenPath;
				await this.deps.saveSettings();
				this.deps.store.setFilePath(chosenPath);
				await this.deps.store.ensureFile();
				await this.deps.revealPanel();
			},
			this.deps.getSettings().bookmarksFilePath,
		).open();
	}

	async openBookmarkQuickOpen(): Promise<void> {
		const store = this.lastKnownStore ?? await this.deps.store.parse();
		new BookmarkQuickOpenModal(
			this.deps.app,
			store,
			this.deps.getRecentBookmarkUrls(),
			this,
		).open();
	}

	recordRecentBookmark(url: string): void {
		this.deps.recordRecentBookmark(url);
	}

	openSettings(): void {
		const settingsApi = (this.deps.app as unknown as { setting?: AppSettingsApi }).setting;
		if (settingsApi && typeof settingsApi.open === "function") {
			settingsApi.open();
			settingsApi.openTabById(this.deps.manifestId);
		}
	}

	async reloadBookmarks(): Promise<void> {
		await this.deps.refreshViews();
	}

	openBookmarkUrl(url: string): void {
		if (/[\x00-\x1f\x7f]/.test(url)) {
			new Notice("Launchpad: URL contains invalid characters and was not opened.");
			return;
		}

		if (url.startsWith("vault://")) {
			let folderPath = "";
			try {
				folderPath = decodeURIComponent(url.slice("vault://".length));
			} catch {
				new Notice("Launchpad: invalid vault path encoding.");
				return;
			}
			const folder = this.deps.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				new Notice(`Launchpad: folder not found — ${folderPath}`);
				return;
			}
			const leaves = this.deps.app.workspace.getLeavesOfType("file-explorer");
			if (leaves.length > 0) {
				try {
					this.deps.app.workspace.revealLeaf(leaves[0]);
					const view = leaves[0].view as unknown as FileExplorerViewLike;
					if (typeof view.revealInFolder === "function") {
						view.revealInFolder(folder);
						return;
					}
				} catch {
					// fall through to Notice
				}
			}
			new Notice(`Launchpad: ${folderPath}`);
		} else if (url.startsWith("note://")) {
			const notePath = url.slice("note://".length);
			const file = this.deps.app.metadataCache.getFirstLinkpathDest(notePath, "");
			if (!file) {
				new Notice(`Launchpad: note not found — ${notePath}`);
				return;
			}
			void this.deps.app.workspace.getLeaf(false).openFile(file);
		} else if (url.startsWith("obsidian://")) {
			this.previousFile = this.deps.app.workspace.getActiveFile();
			window.open(url);
			void this.deps.refreshViews();
		} else if (url.startsWith("https://") || url.startsWith("http://")) {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	}

	getPreviousFilename(): string | null {
		return this.previousFile?.basename ?? null;
	}

	async navigateBack(): Promise<void> {
		const file = this.previousFile;
		if (!file) return;
		this.previousFile = null;
		if (!(this.deps.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
			await this.deps.refreshViews();
			return;
		}
		await this.deps.app.workspace.getLeaf(false).openFile(file);
		await this.deps.refreshViews();
	}

	isTabsSectionEnabled(): boolean {
		return this.deps.getSettings().tabsSectionEnabled;
	}

	getOpenTabs(): OpenTab[] {
		const tabs: OpenTab[] = [];
		this.deps.app.workspace.iterateAllLeaves((leaf) => {
			const workspaceLeaf = leaf as unknown as WorkspaceLeafWithRoot;
			if (workspaceLeaf.view.getViewType() === VIEW_TYPE_BOOKMARK) return;
			const root = workspaceLeaf.getRoot?.();
			if (root !== this.deps.app.workspace.rootSplit) return;
			if (!workspaceLeaf.id) return;
			tabs.push({
				title: workspaceLeaf.view.getDisplayText(),
				type: workspaceLeaf.view.getViewType(),
				leafId: workspaceLeaf.id,
			});
		});
		return tabs;
	}

	focusTab(leafId: string): void {
		this.deps.app.workspace.iterateAllLeaves((leaf) => {
			if ((leaf as unknown as WorkspaceLeafWithRoot).id === leafId) {
				this.deps.app.workspace.setActiveLeaf(leaf, { focus: true });
			}
		});
	}

	isLatestSectionEnabled(): boolean {
		return this.deps.getSettings().latestSectionEnabled;
	}

	getLatestExcludedPaths(): Set<string> {
		if (this.excludedPathsCache !== null) return this.excludedPathsCache;
		this.excludedPathsCache = new Set(
			this.deps.getSettings().latestExcludedFiles
				.split(",")
				.map((value) => value.trim())
				.filter((value) => value.length > 0)
		);
		return this.excludedPathsCache;
	}

	private getFilesSnapshot(): LatestFile[] {
		if (this.latestFilesSnapshotCache && this.latestFilesSnapshotReuseCount > 0) {
			this.latestFilesSnapshotReuseCount -= 1;
			const snapshot = this.latestFilesSnapshotCache;
			if (this.latestFilesSnapshotReuseCount === 0) {
				this.latestFilesSnapshotCache = null;
			}
			return [...snapshot];
		}

		const excludedPaths = this.getLatestExcludedPaths();
		const snapshot = this.deps.app.vault
			.getFiles()
			.filter((file) => file.extension === "md")
			.filter((file) => !excludedPaths.has(file.path))
			.map((file) => ({
				title: file.basename,
				path: file.path,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
			}));

		this.latestFilesSnapshotCache = snapshot;
		this.latestFilesSnapshotReuseCount = 1;
		return [...snapshot];
	}

	getLatestCreatedFiles(): LatestFile[] {
		return this.getFilesSnapshot()
			.sort((a, b) => b.ctime - a.ctime)
			.slice(0, this.deps.getSettings().latestFilesCount);
	}

	getLatestModifiedFiles(): LatestFile[] {
		const snapshot = this.getFilesSnapshot();
		const createdPaths = new Set(
			[...snapshot]
				.sort((a, b) => b.ctime - a.ctime)
				.slice(0, this.deps.getSettings().latestFilesCount)
				.map((file) => file.path)
		);
		return snapshot
			.filter((file) => !createdPaths.has(file.path))
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, this.deps.getSettings().latestFilesCount);
	}

	openLatestFile(path: string): void {
		const file = this.deps.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			void this.deps.app.workspace.getLeaf(false).openFile(file);
		}
	}

	async deleteLatestFile(path: string): Promise<void> {
		const file = this.deps.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.deps.app.vault.trash(file, true);
			await this.deps.refreshViews();
		}
	}

	isDeleteEnabled(): boolean {
		return this.deps.getSettings().latestDeleteEnabled;
	}
}
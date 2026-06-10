import {
	Menu,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import { BookmarkStoreManager, DEFAULT_BOOKMARKS_FILE, FOLDER_SEP } from "./BookmarkStore";
import { BookmarkView, VIEW_TYPE_BOOKMARK } from "./BookmarkView";
import { BookmarkStore } from "./types";
import { LaunchpadHost } from "./LaunchpadHost";
import { LaunchpadSettingTab } from "./SettingsTab";
import { LATEST_FILES_COUNT_MAX } from "./utils";

const REFRESH_RETRY_MAX_ATTEMPTS = 6;

interface PluginData {
	collapseState: Record<string, boolean>;
	/** Vault-relative path to the bookmarks file. Null = not yet configured. */
	bookmarksFilePath: string | null;
	latestFilesCount: number;
	latestDeleteEnabled: boolean;
	tabsSectionEnabled: boolean;
	latestSectionEnabled: boolean;
	latestExcludedFiles: string;
	recentBookmarkUrls: string[];
}

/**
 * Coerces persisted plugin data into a safe, fully-typed shape.
 */
export function sanitizePluginData(raw: unknown): PluginData {
	const data = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
	const collapseStateRaw =
		data.collapseState && typeof data.collapseState === "object"
			? data.collapseState as Record<string, unknown>
			: {};
	const collapseState: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(collapseStateRaw)) {
		if (typeof value === "boolean") collapseState[key] = value;
	}

	const bookmarksFilePath =
		typeof data.bookmarksFilePath === "string"
			? data.bookmarksFilePath
			: null;

	const latestFilesCount =
		typeof data.latestFilesCount === "number"
		&& Number.isInteger(data.latestFilesCount)
		&& data.latestFilesCount > 0
		&& data.latestFilesCount <= LATEST_FILES_COUNT_MAX
			? data.latestFilesCount
			: DEFAULT_DATA.latestFilesCount;

	const latestDeleteEnabled =
		typeof data.latestDeleteEnabled === "boolean"
			? data.latestDeleteEnabled
			: DEFAULT_DATA.latestDeleteEnabled;

	const tabsSectionEnabled =
		typeof data.tabsSectionEnabled === "boolean"
			? data.tabsSectionEnabled
			: DEFAULT_DATA.tabsSectionEnabled;

	const latestSectionEnabled =
		typeof data.latestSectionEnabled === "boolean"
			? data.latestSectionEnabled
			: DEFAULT_DATA.latestSectionEnabled;

	const latestExcludedFiles =
		typeof data.latestExcludedFiles === "string"
			? data.latestExcludedFiles
			: DEFAULT_DATA.latestExcludedFiles;

	const recentBookmarkUrls =
		Array.isArray(data.recentBookmarkUrls)
			? (data.recentBookmarkUrls as unknown[])
				.filter((v): v is string => typeof v === "string")
				.slice(0, 5)
			: DEFAULT_DATA.recentBookmarkUrls;

	return {
		collapseState,
		bookmarksFilePath,
		latestFilesCount,
		latestDeleteEnabled,
		tabsSectionEnabled,
		latestSectionEnabled,
		latestExcludedFiles,
		recentBookmarkUrls,
	};
}

const DEFAULT_DATA: PluginData = {
	collapseState: {},
	bookmarksFilePath: null,
	latestFilesCount: 5,
	latestDeleteEnabled: false,
	tabsSectionEnabled: true,
	latestSectionEnabled: true,
	latestExcludedFiles: "",
	recentBookmarkUrls: [],
};

export default class LaunchpadPlugin extends Plugin {
	store!: BookmarkStoreManager;
	private host!: LaunchpadHost;
	private data!: PluginData;
	/** Pending exponential-backoff retry for refreshViews when iCloud read fails. */
	private refreshRetryTimer: number | null = null;
	/** Debounce timer for batching rapid collapse state writes. */
	private collapseDebounceTimer: number | null = null;
	/** Debounce timer for workspace-event-triggered refreshes. */
	private refreshDebounceTimer: number | null = null;
	private refreshRequestId = 0;

	/** Alias so settings tab and host methods share one property name. */
	get settings(): PluginData {
		return this.data;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.data);
	}

	/** Invalidates the excluded paths cache. Call when latestExcludedFiles changes. */
	invalidateExcludedPathsCache(): void {
		this.host.invalidateExcludedPathsCache();
	}

	async onload(): Promise<void> {
		this.data = sanitizePluginData(await this.loadData());

		// Initialise the store with whatever path we have so far (may be null →
		// falls back to the default constant; we'll update it after setup).
		this.store = new BookmarkStoreManager(
			this.app,
			this.data.bookmarksFilePath ?? DEFAULT_BOOKMARKS_FILE
		);
		this.host = new LaunchpadHost({
			app: this.app,
			store: this.store,
			manifestId: this.manifest.id,
			getSettings: () => this.settings,
			saveSettings: () => this.saveSettings(),
			refreshViews: () => this.refreshViews(),
			revealPanel: () => this.revealPanel(),
			getCollapseStateRecord: () => this.data.collapseState,
			getRecentBookmarkUrls: () => this.data.recentBookmarkUrls,
			recordRecentBookmark: (url: string) => {
				const filtered = this.data.recentBookmarkUrls.filter(u => u !== url);
				this.data.recentBookmarkUrls = [url, ...filtered].slice(0, 5);
				void this.saveSettings();
			},
			setCollapseStateRecord: (key, collapsed) => {
				this.data.collapseState[key] = collapsed;
				if (this.collapseDebounceTimer !== null) {
					window.clearTimeout(this.collapseDebounceTimer);
				}
				this.collapseDebounceTimer = window.setTimeout(async () => {
					this.collapseDebounceTimer = null;
					await this.saveSettings();
				}, 300);
			},
		});

		this.registerView(VIEW_TYPE_BOOKMARK, (leaf) => new BookmarkView(leaf, this.host));

		this.addRibbonIcon("rocket", "Launchpad", () => this.revealPanel());

		this.addCommand({
			id: "open-bookmark",
			name: "Open bookmark",
			callback: () => void this.host.openBookmarkQuickOpen(),
		});

		this.addCommand({
			id: "add-bookmark",
			name: "Add bookmark",
			callback: () => this.host.openCaptureModal(),
		});

		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => this.revealPanel(),
		});

		this.addSettingTab(new LaunchpadSettingTab(this.app, this));

		// iOS iCloud hydration often surfaces as a modify event on the target
		// file, so keep a scoped modify watcher to refresh the panel promptly.
		const onBookmarksFileModify = (file: TAbstractFile) => {
			if (file instanceof TFile && file.path === this.store.getFilePath())
				this.refreshViews();
		};
		this.registerEvent(this.app.vault.on("modify", onBookmarksFileModify));

		// Keep create handling too, since first-run setup can create the file.
		const onBookmarksFileCreate = (file: TAbstractFile) => {
			if (file instanceof TFile && file.path === this.store.getFilePath())
				this.refreshViews();
		};
		this.registerEvent(this.app.vault.on("create", onBookmarksFileCreate));

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

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.debouncedRefresh())
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view.getViewType() === VIEW_TYPE_BOOKMARK) return;
				this.debouncedRefresh();
			})
		);

		this.app.workspace.onLayoutReady(() => this.initOnReady());
	}

	async onunload(): Promise<void> {
		if (this.refreshRetryTimer !== null) {
			window.clearTimeout(this.refreshRetryTimer);
			this.refreshRetryTimer = null;
		}
		if (this.collapseDebounceTimer !== null) {
			window.clearTimeout(this.collapseDebounceTimer);
			// Flush any pending collapse state write before unloading.
			await this.saveSettings();
			this.collapseDebounceTimer = null;
		}
		if (this.refreshDebounceTimer !== null) {
			window.clearTimeout(this.refreshDebounceTimer);
			this.refreshDebounceTimer = null;
		}
	}

	private debouncedRefresh(delayMs = 150): void {
		if (this.refreshDebounceTimer !== null) {
			window.clearTimeout(this.refreshDebounceTimer);
		}
		this.refreshDebounceTimer = window.setTimeout(() => {
			this.refreshDebounceTimer = null;
			this.refreshViews();
		}, delayMs);
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
		this.host.openSetupModal();
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

	/** Persist a confirmed bookmarks file path and point the store at it. */
	private async adoptPath(path: string): Promise<void> {
		this.data.bookmarksFilePath = path;
		await this.saveSettings();
		this.store.setFilePath(path);
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

	/**
	 * Removes collapse state entries for folders that no longer exist in the
	 * current store. Keeps system section keys and any key matching a known
	 * folder or subfolder in the parsed store. Called after every successful
	 * parse to prevent unbounded growth from renamed or deleted folders.
	 */
	private pruneCollapseState(store: BookmarkStore): void {
		const systemKeys = new Set([
			"__tabs__",
			"__latest__",
			"__latest_created__",
			"__latest_modified__",
		]);

		// Build the set of valid folder collapse keys from the current store.
		const validFolderKeys = new Set<string>();
		for (const folder of store.folders) {
			validFolderKeys.add(folder.name);
			for (const sub of folder.subfolders) {
				validFolderKeys.add(`${folder.name}${FOLDER_SEP}${sub.name}`);
			}
		}

		let changed = false;
		for (const key of Object.keys(this.data.collapseState)) {
			if (!systemKeys.has(key) && !validFolderKeys.has(key)) {
				delete this.data.collapseState[key];
				changed = true;
			}
		}

		// Only persist if something was actually pruned — avoids a redundant
		// disk write on every refresh when no stale keys exist.
		if (changed) {
			void this.saveSettings();
		}
	}

	async refreshViews(retryCount = 0): Promise<void> {
		const requestId = ++this.refreshRequestId;
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK);
		if (leaves.length === 0) return;
		// While iOS/iCloud hydration retries are in progress, render a loading
		// state instead of a misleading empty-store message.
		for (const leaf of leaves) {
			if (leaf.view instanceof BookmarkView) {
				leaf.view.setLoading(true);
			}
		}
		let storeData;
		try {
			storeData = await this.store.parse();
		} catch {
			// File not yet readable (e.g. iCloud stub not yet downloaded on iOS).
			// vault modify/create events don't fire when iCloud hydrates a stub,
			// so retry with exponential backoff (6 attempts, ~63 s total).
			if (retryCount < REFRESH_RETRY_MAX_ATTEMPTS) {
				// Multiple refresh failures can stack timers; clear before rescheduling the next retry.
				if (this.refreshRetryTimer !== null) {
					window.clearTimeout(this.refreshRetryTimer);
				}
				this.refreshRetryTimer = window.setTimeout(
					() => this.refreshViews(retryCount + 1),
					1000 * Math.pow(2, retryCount)
				);
			}
			return;
		}
		if (requestId !== this.refreshRequestId) {
			// A newer refresh completed while this one was parsing; discard stale render state.
			return;
		}
		// Successful read — cancel any pending retry.
		if (this.refreshRetryTimer !== null) {
			window.clearTimeout(this.refreshRetryTimer);
			this.refreshRetryTimer = null;
		}
		this.host.setLastKnownStore(storeData);
		this.pruneCollapseState(storeData);
		for (const leaf of leaves) {
			if (leaf.view instanceof BookmarkView) {
				leaf.view.setStore(storeData);
			}
		}
	}
}

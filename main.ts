import {
	App,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import { BookmarkStoreManager, DEFAULT_BOOKMARKS_FILE } from "./BookmarkStore";
import { BookmarkView, BookmarkViewHost, VIEW_TYPE_BOOKMARK } from "./BookmarkView";
import { LatestFile, OpenTab } from "./types";
import { CaptureModal } from "./CaptureModal";
import { SetupModal } from "./SetupModal";
import { t } from "./i18n";

const REFRESH_RETRY_MAX_ATTEMPTS = 6;
const LATEST_FILES_COUNT_MAX = 50;

interface WorkspacePrivateApi {
	rootSplit?: unknown;
	iterateLeaves?: (callback: (leaf: WorkspaceLeafLike) => void, root: unknown) => void;
}

interface WorkspaceLeafLike {
	id?: string;
	view: {
		getViewType(): string;
		getDisplayText(): string;
	};
}

interface FileExplorerViewLike {
	revealInFolder?: (folder: TFolder) => void;
}

interface AppSettingsApi {
	open: () => void;
	openTabById: (id: string) => void;
}

interface PluginData {
	collapseState: Record<string, boolean>;
	/** Vault-relative path to the bookmarks file. Null = not yet configured. */
	bookmarksFilePath: string | null;
	latestFilesCount: number;
	latestDeleteEnabled: boolean;
}

/**
 * Coerces persisted plugin data into a safe, fully-typed shape.
 */
function sanitizePluginData(raw: unknown): PluginData {
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

	return {
		collapseState,
		bookmarksFilePath,
		latestFilesCount,
		latestDeleteEnabled,
	};
}

const DEFAULT_DATA: PluginData = {
	collapseState: {},
	bookmarksFilePath: null,
	latestFilesCount: 5,
	latestDeleteEnabled: false,
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
	/** Debounce timer for workspace-event-triggered refreshes. */
	private refreshDebounceTimer: number | null = null;
	private refreshRequestId = 0;
	private latestFilesSnapshotCache: LatestFile[] | null = null;
	private latestFilesSnapshotReuseCount = 0;

	/** Alias so settings tab and host methods share one property name. */
	get settings(): PluginData {
		return this.data;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.data);
	}

	async onload(): Promise<void> {
		this.data = sanitizePluginData(await this.loadData());

		// Initialise the store with whatever path we have so far (may be null →
		// falls back to the default constant; we'll update it after setup).
		this.store = new BookmarkStoreManager(
			this.app,
			this.data.bookmarksFilePath ?? DEFAULT_BOOKMARKS_FILE
		);

		this.registerView(VIEW_TYPE_BOOKMARK, (leaf) => new BookmarkView(leaf, this));

		this.addRibbonIcon("rocket", "Launchpad", () => this.revealPanel());

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
		new SetupModal(
			this.app,
			async (chosenPath: string) => {
				await this.adoptPath(chosenPath);
				await this.store.ensureFile();
				await this.revealPanel();
				// Note: errors propagate back to SetupModal's try/catch, which
				// displays them in the modal's error element and re-enables the button.
			},
			this.data.bookmarksFilePath,
		).open();
	}

	/** Called from the sidebar gear button — implements BookmarkViewHost. */
	openSetupModal(): void {
		this.showSetupModal();
	}

	/** Opens Obsidian's settings modal on this plugin's settings tab. */
	openSettings(): void {
		const settingsApi = (this.app as unknown as { setting?: AppSettingsApi }).setting;
		if (settingsApi && typeof settingsApi.open === "function") {
			settingsApi.open();
			settingsApi.openTabById(this.manifest.id);
		}
	}

	/** Persist a confirmed bookmarks file path and point the store at it. */
	private async adoptPath(path: string): Promise<void> {
		this.data.bookmarksFilePath = path;
		await this.saveSettings();
		this.store.setFilePath(path);
	}

	// ── BookmarkViewHost ───────────────────────────────────────────────────

	async openCaptureModal(): Promise<void> {
		const storeData = await this.store.parse();
		// Provide folder options via callback so CaptureModal resolves them
		// at open time rather than storing a long-lived snapshot.
		new CaptureModal(
			this.app,
			this.store,
			() => this.store.getFolderOptions(storeData)
		).open();
	}

	getCollapseState(): Record<string, boolean> {
		return this.data.collapseState;
	}

	async setCollapseState(key: string, collapsed: boolean): Promise<void> {
		this.data.collapseState[key] = collapsed;
		await this.saveSettings();
	}

	async reloadBookmarks(): Promise<void> {
		await this.refreshViews();
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
			let folderPath = "";
			try {
				folderPath = decodeURIComponent(url.slice("vault://".length));
			} catch {
				// Malformed percent-encoding in user-edited bookmarks must not crash click handling.
				new Notice("Launchpad: invalid vault path encoding.");
				return;
			}
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				new Notice(`Launchpad: folder not found — ${folderPath}`);
				return;
			}
			const leaves = this.app.workspace.getLeavesOfType("file-explorer");
			if (leaves.length > 0) {
				try {
					this.app.workspace.revealLeaf(leaves[0]);
					// Obsidian does not expose a typed File Explorer API for revealInFolder.
					const view = leaves[0].view as unknown as FileExplorerViewLike;
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
			void this.app.workspace.getLeaf(false).openFile(file);
		} else if (url.startsWith("obsidian://")) {
			this.previousFile = this.app.workspace.getActiveFile();
			window.open(url);
			void this.refreshViews();
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

	getOpenTabs(): OpenTab[] {
		const tabs: OpenTab[] = [];
		const workspacePrivate = this.app.workspace as unknown as WorkspacePrivateApi;
		const root = workspacePrivate.rootSplit;
		const iterateLeaves = workspacePrivate.iterateLeaves;

		const collectLeaf = (leaf: WorkspaceLeafLike): void => {
			if (!leaf.id) return;
			if (!leaf.view) return;
			if (typeof leaf.view.getViewType !== "function") return;
			if (typeof leaf.view.getDisplayText !== "function") return;
			if (leaf.view.getViewType() === VIEW_TYPE_BOOKMARK) return;
			tabs.push({
				title: leaf.view.getDisplayText(),
				type: leaf.view.getViewType(),
				leafId: leaf.id,
			});
		};

		if (!iterateLeaves || !root) {
			// Some Obsidian builds do not expose rootSplit/iterateLeaves; fallback keeps Tabs available.
			this.app.workspace.iterateAllLeaves((leaf) => {
				collectLeaf(leaf as unknown as WorkspaceLeafLike);
			});
			return tabs;
		}

		// iterateAllLeaves includes sidebars — walk rootSplit only to get
		// main editor tabs, excluding left/right sidebar panels.
		iterateLeaves((leaf) => {
			collectLeaf(leaf);
		}, root);

		return tabs;
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

		const snapshot = this.app.vault
			.getFiles()
			.filter((file) => file.extension === "md")
			.map((file) => ({
				title: file.basename,
				path: file.path,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
			}));

		// Created and Modified are requested back-to-back during a single render.
		// Reusing one snapshot avoids scanning/sorting the vault twice.
		this.latestFilesSnapshotCache = snapshot;
		this.latestFilesSnapshotReuseCount = 1;
		return [...snapshot];
	}

	getLatestCreatedFiles(): LatestFile[] {
		return this.getFilesSnapshot()
			.sort((a, b) => b.ctime - a.ctime)
			.slice(0, this.settings.latestFilesCount);
	}

	getLatestModifiedFiles(): LatestFile[] {
		const snapshot = this.getFilesSnapshot();
		const createdPaths = new Set(
			[...snapshot]
				.sort((a, b) => b.ctime - a.ctime)
				.slice(0, this.settings.latestFilesCount)
				.map((file) => file.path)
		);
		return snapshot
			.filter((file) => !createdPaths.has(file.path))
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, this.settings.latestFilesCount);
	}

	openLatestFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	async deleteLatestFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			// true = use system trash where available.
			await this.app.vault.trash(file, true);
			await this.refreshViews();
		}
	}

	isDeleteEnabled(): boolean {
		return this.settings.latestDeleteEnabled;
	}

	focusTab(leafId: string): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if ((leaf as unknown as WorkspaceLeafLike).id === leafId) {
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			}
		});
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
		for (const leaf of leaves) {
			if (leaf.view instanceof BookmarkView) {
				leaf.view.setStore(storeData);
			}
		}
	}
}

class LaunchpadSettingTab extends PluginSettingTab {
	plugin: LaunchpadPlugin;

	constructor(app: App, plugin: LaunchpadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("settings.latestCount.name"))
			.setDesc(t("settings.latestCount.desc"))
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.plugin.settings.latestFilesCount))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0 && n <= LATEST_FILES_COUNT_MAX) {
							this.plugin.settings.latestFilesCount = n;
							await this.plugin.saveSettings();
							await this.plugin.refreshViews();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("settings.latestDelete.name"))
			.setDesc(t("settings.latestDelete.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.latestDeleteEnabled)
					.onChange(async (value) => {
						this.plugin.settings.latestDeleteEnabled = value;
						await this.plugin.saveSettings();
						await this.plugin.refreshViews();
					})
			);
	}
}

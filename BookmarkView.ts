import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { BookmarkFolder, BookmarkStore, LatestFile, OpenTab } from "./types";
import { FOLDER_SEP } from "./BookmarkStore";
import { t } from "./i18n";
import { renderLatestSubsection } from "./LatestSectionRenderer.js";
import { attachCollapseHandler, setIconWithFallback } from "./utils";

export const VIEW_TYPE_BOOKMARK = "launchpad-view";

/** Collapse state persistence — used by all collapsible sections. */
export interface CollapseHost {
	getCollapseState(): Record<string, boolean>;
	setCollapseState(key: string, collapsed: boolean): Promise<void>;
}

/** Bookmark file operations and modal entry points. */
export interface BookmarkHost {
	openCaptureModal(): Promise<void>;
	openSetupModal(): void;
	openSettings(): void;
	/** Re-parses the bookmarks file and re-renders the panel. */
	reloadBookmarks(): Promise<void>;
	openBookmarkUrl(url: string): void;
}

/** Back-navigation after obsidian:// link opens. */
export interface NavigationHost {
	getPreviousFilename(): string | null;
	navigateBack(): Promise<void>;
}

/** Tabs section data and interaction. */
export interface TabsHost {
	/** Whether the Tabs section should be rendered. */
	isTabsSectionEnabled(): boolean;
	getOpenTabs(): OpenTab[];
	focusTab(leafId: string): void;
}

/** Latest section data, interaction, and settings. */
export interface LatestHost {
	/** Whether the Latest section should be rendered. */
	isLatestSectionEnabled(): boolean;
	getLatestCreatedFiles(): LatestFile[];
	getLatestModifiedFiles(): LatestFile[];
	/** Returns the set of vault-relative file paths to exclude from Latest. */
	getLatestExcludedPaths(): Set<string>;
	openLatestFile(path: string): void;
	deleteLatestFile(path: string): Promise<void>;
	isDeleteEnabled(): boolean;
}

/** Full host interface implemented by LaunchpadPlugin. */
export interface BookmarkViewHost
	extends CollapseHost,
		BookmarkHost,
		NavigationHost,
		TabsHost,
		LatestHost {}

export class BookmarkView extends ItemView {
	private host: BookmarkViewHost;
	private store: BookmarkStore = { folders: [], uncategorized: [] };

	constructor(leaf: WorkspaceLeaf, host: BookmarkViewHost) {
		super(leaf);
		this.host = host;
	}

	getViewType(): string {
		return VIEW_TYPE_BOOKMARK;
	}

	getDisplayText(): string {
		return "Launchpad";
	}

	getIcon(): string {
		return "rocket";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	setStore(store: BookmarkStore): void {
		this.store = store;
		this.render();
	}

	setLoading(isLoading: boolean): void {
		if (isLoading) {
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: "launchpad-loading", text: t("panel.loading") });
		}
	}

	private render(): void {
		// A child wrapper is required because contentEl height does not resolve
		// reliably from a flex parent on all Obsidian platforms.
		this.contentEl.empty();
		this.contentEl.addClass("launchpad-content-el");
		const containerEl = this.contentEl.createDiv("launchpad-container");
		containerEl.setAttribute("role", "navigation");

		// Header: title + settings + add buttons
		const headerEl = containerEl.createDiv("launchpad-header");
		headerEl.createSpan({ text: t("panel.title") });
		const settingsButtonEl = headerEl.createEl("button", {
			cls: "launchpad-settings-btn",
			attr: { "aria-label": t("bookmark.settings"), type: "button" },
		});
		setIcon(settingsButtonEl, "settings-2");
		settingsButtonEl.addEventListener("click", () => this.host.openSettings());

		const addButtonEl = headerEl.createEl("button", {
			cls: "launchpad-add-btn",
			attr: { "aria-label": t("bookmark.add"), type: "button" },
		});
		setIcon(addButtonEl, "plus-circle");
		addButtonEl.addEventListener("click", () => this.host.openCaptureModal());

		const scrollContainerEl = containerEl.createDiv("launchpad-scroll");
		const collapseState = this.host.getCollapseState();

		this.renderBookmarkSections(scrollContainerEl, collapseState);

		if (this.host.isTabsSectionEnabled()) {
			this.renderTabsSection(scrollContainerEl, collapseState);
		}

		if (this.host.isLatestSectionEnabled()) {
			this.renderLatestSection(scrollContainerEl, collapseState);
		}

		this.renderBackNavigation(containerEl);
	}

	/** Renders uncategorized bookmarks, all bookmark folders, and the empty state. */
	private renderBookmarkSections(
		scrollContainerEl: HTMLElement,
		collapseState: Record<string, boolean>
	): void {
		if (this.store.uncategorized.length > 0) {
			const uncategorizedSectionEl = scrollContainerEl.createDiv(
				"launchpad-uncategorized"
			);
			for (const bookmark of this.store.uncategorized) {
				this.renderBookmarkItem(
					uncategorizedSectionEl,
					bookmark.name,
					bookmark.url
				);
			}
		}

		for (const folder of this.store.folders) {
			this.renderFolder(scrollContainerEl, folder, collapseState, null);
		}

		if (
			this.store.folders.length === 0 &&
			this.store.uncategorized.length === 0
		) {
			const emptyStateEl = scrollContainerEl.createDiv("launchpad-empty-state");
			emptyStateEl.createDiv({ cls: "launchpad-empty", text: t("panel.empty") });
			const reloadButtonEl = emptyStateEl.createEl("button", {
				cls: "launchpad-reload-btn",
				attr: { type: "button", "aria-label": t("panel.reloadAriaLabel") },
			});
			const reloadIconEl = reloadButtonEl.createSpan({
				attr: { "aria-hidden": "true" },
			});
			setIconWithFallback(reloadIconEl, "refresh-cw", "rotate-cw");
			reloadButtonEl.createSpan({ text: t("panel.reload") });
			reloadButtonEl.addEventListener("click", () =>
				void this.host.reloadBookmarks()
			);
		}
	}

	/** Renders the Tabs section into the given scroll container. */
	private renderTabsSection(
		scrollContainerEl: HTMLElement,
		collapseState: Record<string, boolean>
	): void {
		let openTabs: OpenTab[] = [];
		try {
			openTabs = this.host.getOpenTabs();
		} catch (error) {
			console.error("Launchpad: failed to collect open tabs", error);
		}

		const tabsKey = "__tabs__";
		const tabsCollapsed = collapseState[tabsKey] ?? false;

		const tabsFolderEl = scrollContainerEl.createDiv(
			"launchpad-folder launchpad-tabs-folder"
		);
		const tabsHeaderEl = tabsFolderEl.createEl("button", {
			cls: "launchpad-folder-header",
			attr: { type: "button", "aria-expanded": (!tabsCollapsed).toString() },
		});
		const tabsIconEl = tabsHeaderEl.createSpan({
			cls: "lp-folder-icon",
			attr: { "aria-hidden": "true" },
		});
		setIconWithFallback(tabsIconEl, "layout-grid", "layout-dashboard");
		tabsHeaderEl.createSpan({ text: t("tabs.folder") });
		const tabsArrowEl = tabsHeaderEl.createSpan({
			cls: "launchpad-folder-arrow" + (tabsCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const tabsContentEl = tabsFolderEl.createDiv("launchpad-folder-content");
		if (tabsCollapsed) tabsContentEl.addClass("is-collapsed");
		const tabsInnerEl = tabsContentEl.createDiv("lp-inner");

		attachCollapseHandler(
			tabsHeaderEl,
			tabsContentEl,
			tabsArrowEl,
			tabsKey,
			(key, collapsed) => this.host.setCollapseState(key, collapsed)
		);

		if (openTabs.length === 0) {
			tabsInnerEl.createDiv({ cls: "launchpad-empty", text: t("tabs.empty") });
		} else {
			for (const tab of openTabs) {
				this.renderTabItem(tabsInnerEl, tab);
			}
		}
	}

	/** Renders the Latest section (Created + Modified subsections). */
	private renderLatestSection(
		scrollContainerEl: HTMLElement,
		collapseState: Record<string, boolean>
	): void {
		let latestCreated: LatestFile[] = [];
		let latestModified: LatestFile[] = [];
		try {
			latestCreated = this.host.getLatestCreatedFiles();
			latestModified = this.host.getLatestModifiedFiles();
		} catch (error) {
			console.error("Launchpad: failed to collect latest files", error);
		}

		const latestKey = "__latest__";
		const latestCollapsed = collapseState[latestKey] ?? false;

		const latestFolderEl = scrollContainerEl.createDiv(
			"launchpad-folder launchpad-latest-folder"
		);
		const latestHeaderEl = latestFolderEl.createEl("button", {
			cls: "launchpad-folder-header",
			attr: { type: "button", "aria-expanded": (!latestCollapsed).toString() },
		});
		const latestIconEl = latestHeaderEl.createSpan({
			cls: "lp-folder-icon",
			attr: { "aria-hidden": "true" },
		});
		setIconWithFallback(latestIconEl, "clock", "history");
		latestHeaderEl.createSpan({ text: t("latest.folder") });
		const latestArrowEl = latestHeaderEl.createSpan({
			cls: "launchpad-folder-arrow" + (latestCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const latestContentEl = latestFolderEl.createDiv("launchpad-folder-content");
		if (latestCollapsed) latestContentEl.addClass("is-collapsed");
		const latestInnerEl = latestContentEl.createDiv("lp-inner");

		attachCollapseHandler(
			latestHeaderEl,
			latestContentEl,
			latestArrowEl,
			latestKey,
			(key, collapsed) => this.host.setCollapseState(key, collapsed)
		);

		renderLatestSubsection({
			app: this.app,
			containerEl: latestInnerEl,
			collapseState,
			subsectionKey: "__latest_created__",
			label: t("latest.created"),
			iconName: "file-plus",
			files: latestCreated,
			host: this.host,
			setCollapseState: (key, collapsed) =>
				this.host.setCollapseState(key, collapsed),
		});
		renderLatestSubsection({
			app: this.app,
			containerEl: latestInnerEl,
			collapseState,
			subsectionKey: "__latest_modified__",
			label: t("latest.modified"),
			iconName: "file-edit",
			files: latestModified,
			host: this.host,
			setCollapseState: (key, collapsed) =>
				this.host.setCollapseState(key, collapsed),
		});
	}

	/** Renders the back-navigation link pinned to the panel bottom. */
	private renderBackNavigation(containerEl: HTMLElement): void {
		const previousFilename = this.host.getPreviousFilename();
		if (previousFilename === null) return;

		const backSectionEl = containerEl.createDiv("launchpad-back-section");
		const backLinkEl = backSectionEl.createEl("a", {
			cls: "launchpad-back-item",
			attr: { href: "#" },
		});
		const backIconEl = backLinkEl.createSpan({
			cls: "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(backIconEl, "arrow-left");
		backLinkEl.createSpan({ cls: "lp-item-name", text: previousFilename });
		backLinkEl.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.navigateBack();
		});
	}

	private renderFolder(
		containerEl: HTMLElement,
		folder: BookmarkFolder,
		collapseState: Record<string, boolean>,
		parentFolderName: string | null
	): void {
		const collapseKey = parentFolderName
			? `${parentFolderName}${FOLDER_SEP}${folder.name}`
			: folder.name;
		const isCollapsed = collapseState[collapseKey] ?? false;

		const folderEl = containerEl.createDiv(parentFolderName ? "launchpad-subfolder" : "launchpad-folder");
		const headerClassName = parentFolderName ? "launchpad-subfolder-header" : "launchpad-folder-header";
		const headerEl = folderEl.createEl("button", {
			cls: headerClassName,
			attr: { type: "button", "aria-expanded": (!isCollapsed).toString() },
		});
		const folderIconEl = headerEl.createSpan({ cls: "lp-folder-icon", attr: { "aria-hidden": "true" } });
		setIcon(folderIconEl, "layers");
		headerEl.createSpan({ text: folder.name });
		const arrowEl = headerEl.createSpan({
			cls: "launchpad-folder-arrow" + (isCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const contentEl = folderEl.createDiv(parentFolderName ? "launchpad-subfolder-content" : "launchpad-folder-content");
		if (isCollapsed) contentEl.addClass("is-collapsed");
		const innerEl = contentEl.createDiv("lp-inner");

		attachCollapseHandler(
			headerEl,
			contentEl,
			arrowEl,
			collapseKey,
			(key, collapsed) => this.host.setCollapseState(key, collapsed)
		);

		for (const bookmark of folder.bookmarks) this.renderBookmarkItem(innerEl, bookmark.name, bookmark.url);
		for (const subfolder of folder.subfolders) this.renderFolder(innerEl, subfolder, collapseState, folder.name);
	}

	private renderTabItem(containerEl: HTMLElement, tab: OpenTab): void {
		const itemEl = containerEl.createEl("a", {
			cls: "launchpad-item launchpad-tab-item",
			attr: {
				href: "#",
				"aria-label": `${t("tabs.ariaLabel")}: ${tab.title}`,
			},
		});

		const iconEl = itemEl.createSpan({ cls: "lp-item-icon", attr: { "aria-hidden": "true" } });
		const iconName =
			tab.type === "markdown"  ? "file-text" :
			tab.type === "pdf"       ? "file-type" :
			tab.type === "canvas"    ? "layout-dashboard" :
			tab.type === "graph"     ? "git-fork" :
			                           "file";

		setIconWithFallback(iconEl, iconName, "file");
		itemEl.createSpan({ cls: "lp-item-name", text: tab.title });

		itemEl.addEventListener("click", (e) => { e.preventDefault(); this.host.focusTab(tab.leafId); });
	}

	private renderBookmarkItem(
		containerEl: HTMLElement,
		name: string,
		url: string
	): void {
		const itemEl = containerEl.createEl("a", {
			cls: "launchpad-item",
			attr: { href: "#" },
		});
		const isVault = url.startsWith("vault://");
		const isNote = url.startsWith("note://");
		const isObsidian = url.startsWith("obsidian://");
		const itemIconEl = itemEl.createSpan({
			cls: isNote ? "lp-item-icon lp-item-icon--note"
				: isVault ? "lp-item-icon lp-item-icon--vault"
				: isObsidian ? "lp-item-icon lp-item-icon--obsidian"
				: "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});
		const iconName = isNote || isObsidian ? "file-text" : isVault ? "library" : "globe";
		setIcon(itemIconEl, iconName);
		itemEl.createSpan({ cls: "lp-item-name", text: name });
		itemEl.addEventListener("click", (e) => { e.preventDefault(); this.host.openBookmarkUrl(url); });
	}
}

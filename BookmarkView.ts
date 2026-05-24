import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { BookmarkFolder, BookmarkStore, LatestFile, OpenTab } from "./types";
import { FOLDER_SEP } from "./BookmarkStore";
import { t } from "./i18n";
import { renderLatestSubsection, setIconWithFallback } from "./LatestSectionRenderer.js";

export const VIEW_TYPE_BOOKMARK = "launchpad-view";

export interface BookmarkViewHost {
	openCaptureModal(): Promise<void>;
	openSetupModal(): void;
	openSettings(): void;
	getCollapseState(): Record<string, boolean>;
	setCollapseState(key: string, collapsed: boolean): Promise<void>;
	/** Re-parses the bookmarks file and re-renders the panel. */
	reloadBookmarks(): Promise<void>;
	openBookmarkUrl(url: string): void;
	getPreviousFilename(): string | null;
	navigateBack(): Promise<void>;
	getOpenTabs(): OpenTab[];
	focusTab(leafId: string): void;
	getLatestCreatedFiles(): LatestFile[];
	getLatestModifiedFiles(): LatestFile[];
	openLatestFile(path: string): void;
	deleteLatestFile(path: string): Promise<void>;
	isDeleteEnabled(): boolean;
}

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
		this.contentEl.empty();
		this.contentEl.addClass("launchpad-content-el");
		const containerEl = this.contentEl.createDiv("launchpad-container");
		containerEl.setAttribute("role", "navigation");
		containerEl.setAttribute("aria-label", "Launchpad");

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

		if (this.store.uncategorized.length > 0) {
			const uncategorizedSectionEl = scrollContainerEl.createDiv("launchpad-uncategorized");
			for (const bookmark of this.store.uncategorized) {
				this.renderBookmarkItem(uncategorizedSectionEl, bookmark.name, bookmark.url);
			}
		}

		for (const folder of this.store.folders) {
			this.renderFolder(scrollContainerEl, folder, collapseState, null);
		}

		if (this.store.folders.length === 0 && this.store.uncategorized.length === 0) {
			const emptyStateEl = scrollContainerEl.createDiv("launchpad-empty-state");
			emptyStateEl.createDiv({ cls: "launchpad-empty", text: t("panel.empty") });
			const reloadButtonEl = emptyStateEl.createEl("button", {
				cls: "launchpad-reload-btn",
				attr: { type: "button", "aria-label": t("panel.reloadAriaLabel") },
			});
			const reloadIconEl = reloadButtonEl.createSpan({ attr: { "aria-hidden": "true" } });
			setIconWithFallback(reloadIconEl, "refresh-cw", "rotate-cw");
			reloadButtonEl.createSpan({ text: t("panel.reload") });
			reloadButtonEl.addEventListener("click", () => void this.host.reloadBookmarks());
		}

		let openTabs: OpenTab[] = [];
		try {
			openTabs = this.host.getOpenTabs();
		} catch (error) {
			console.error("Launchpad: failed to collect open tabs", error);
		}
		const tabsKey = "__tabs__";
		const tabsCollapsed = collapseState[tabsKey] ?? false;

		const tabsFolderEl = scrollContainerEl.createDiv("launchpad-folder launchpad-tabs-folder");

		const tabsHeaderEl = tabsFolderEl.createEl("button", {
			cls: "launchpad-folder-header",
			attr: {
				type: "button",
				"aria-expanded": (!tabsCollapsed).toString(),
			},
		});
		const tabsIconEl = tabsHeaderEl.createSpan({
			cls: "lp-folder-icon",
			attr: { "aria-hidden": "true" },
		});
		setIconWithFallback(tabsIconEl, "layout-grid", "layout-dashboard");
		tabsHeaderEl.createSpan({ text: t("tabs.folder") });
		const tabsArrow = tabsHeaderEl.createSpan({
			cls: "launchpad-folder-arrow" + (tabsCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const tabsContentEl = tabsFolderEl.createDiv("launchpad-folder-content");
		if (tabsCollapsed) tabsContentEl.addClass("is-collapsed");
		const tabsInnerEl = tabsContentEl.createDiv("lp-inner");
		tabsHeaderEl.addEventListener("click", async () => {
			const nowCollapsed = !tabsContentEl.hasClass("is-collapsed");
			tabsContentEl.toggleClass("is-collapsed", nowCollapsed);
			tabsArrow.classList.toggle("collapsed", nowCollapsed);
			tabsHeaderEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
			await this.host.setCollapseState(tabsKey, nowCollapsed);
		});

		if (openTabs.length === 0) tabsInnerEl.createDiv({ cls: "launchpad-empty", text: t("tabs.empty") });
		else for (const tab of openTabs) this.renderTabItem(tabsInnerEl, tab);

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

		const latestFolderEl = scrollContainerEl.createDiv("launchpad-folder launchpad-latest-folder");

		const latestHeaderEl = latestFolderEl.createEl("button", {
			cls: "launchpad-folder-header",
			attr: {
				type: "button",
				"aria-expanded": (!latestCollapsed).toString(),
			},
		});
		const latestIconEl = latestHeaderEl.createSpan({
			cls: "lp-folder-icon",
			attr: { "aria-hidden": "true" },
		});
		setIconWithFallback(latestIconEl, "clock", "history");
		latestHeaderEl.createSpan({ text: t("latest.folder") });
		const latestArrow = latestHeaderEl.createSpan({
			cls: "launchpad-folder-arrow" + (latestCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const latestContentEl = latestFolderEl.createDiv("launchpad-folder-content");
		if (latestCollapsed) latestContentEl.addClass("is-collapsed");
		const latestInnerEl = latestContentEl.createDiv("lp-inner");
		latestHeaderEl.addEventListener("click", async () => {
			const nowCollapsed = !latestContentEl.hasClass("is-collapsed");
			latestContentEl.toggleClass("is-collapsed", nowCollapsed);
			latestArrow.classList.toggle("collapsed", nowCollapsed);
			latestHeaderEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
			await this.host.setCollapseState(latestKey, nowCollapsed);
		});

		renderLatestSubsection(
			this.app,
			latestInnerEl,
			collapseState,
			"__latest_created__",
			t("latest.created"),
			"file-plus",
			latestCreated,
			this.host,
			(key: string, collapsed: boolean) => this.host.setCollapseState(key, collapsed)
		);
		renderLatestSubsection(
			this.app,
			latestInnerEl,
			collapseState,
			"__latest_modified__",
			t("latest.modified"),
			"file-edit",
			latestModified,
			this.host,
			(key: string, collapsed: boolean) => this.host.setCollapseState(key, collapsed)
		);

		const previousFilename = this.host.getPreviousFilename();
		if (previousFilename !== null) {
			const backSectionEl = containerEl.createDiv("launchpad-back-section");
			const backLinkEl = backSectionEl.createEl("a", {
				cls: "launchpad-back-item",
				attr: { href: "#", title: `${t("back.ariaLabel")} ${previousFilename}` },
			});
			const backIconEl = backLinkEl.createSpan({ cls: "lp-item-icon", attr: { "aria-hidden": "true" } });
			setIcon(backIconEl, "arrow-left");
			backLinkEl.createSpan({ cls: "lp-item-name", text: previousFilename });
			backLinkEl.addEventListener("click", (e) => {
				e.preventDefault();
				this.host.navigateBack();
			});
		}
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

		headerEl.addEventListener("click", async () => {
			const nowCollapsed = !contentEl.hasClass("is-collapsed");
			contentEl.toggleClass("is-collapsed", nowCollapsed);
			arrowEl.classList.toggle("collapsed", nowCollapsed);
			headerEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
			await this.host.setCollapseState(collapseKey, nowCollapsed);
		});

		for (const bookmark of folder.bookmarks) this.renderBookmarkItem(innerEl, bookmark.name, bookmark.url);
		for (const subfolder of folder.subfolders) this.renderFolder(innerEl, subfolder, collapseState, folder.name);
	}

	private renderTabItem(containerEl: HTMLElement, tab: OpenTab): void {
		const itemEl = containerEl.createEl("a", {
			cls: "launchpad-item launchpad-tab-item",
			attr: {
				href: "#",
				title: tab.title,
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
			attr: { href: "#", title: url },
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

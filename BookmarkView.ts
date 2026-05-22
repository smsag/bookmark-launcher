import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { BookmarkFolder, BookmarkStore, OpenTab } from "./types";
import { FOLDER_SEP } from "./BookmarkStore";
import { t } from "./i18n";

export const VIEW_TYPE_BOOKMARK = "launchpad-view";

export interface BookmarkViewHost {
	openCaptureModal(): Promise<void>;
	/** Open the setup modal to change the bookmarks file path. */
	openSetupModal(): void;
	/** Open the plugin settings tab in Obsidian's settings modal. */
	openSettings(): void;
	getCollapseState(): Record<string, boolean>;
	setCollapseState(key: string, collapsed: boolean): Promise<void>;
	/** Open a bookmark URL; captures the active file for obsidian:// links. */
	openBookmarkUrl(url: string): void;
	/** Returns the basename of the file to navigate back to, or null. */
	getPreviousFilename(): string | null;
	/** Navigate back to the captured file and clear the back-link. */
	navigateBack(): Promise<void>;
	/** Returns all currently open tabs except the Launchpad panel itself. */
	getOpenTabs(): OpenTab[];
	/** Focuses the tab with the given leafId. */
	focusTab(leafId: string): void;
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
			// iOS/iCloud parse retries can take seconds; show explicit loading
			// instead of the empty-state message to avoid false data-loss signals.
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: "launchpad-loading", text: t("panel.loading") });
		}
		// if false: caller will immediately follow with setStore(), which re-renders
	}

	private render(): void {
		// A child div is required — height: 100% on contentEl itself doesn't
		// resolve correctly against a flex-determined parent.
		this.contentEl.empty();
		this.contentEl.addClass("launchpad-content-el");
		const container = this.contentEl.createDiv("launchpad-container");
		container.setAttribute("role", "navigation");
		container.setAttribute("aria-label", "Launchpad");

		const header = container.createDiv("launchpad-header");
		header.createSpan({ text: t("panel.title") });
		const settingsBtn = header.createEl("button", {
			cls: "launchpad-settings-btn",
			attr: { "aria-label": t("bookmark.settings"), type: "button" },
		});
		setIcon(settingsBtn, "settings-2");
		settingsBtn.addEventListener("click", () => this.host.openSettings());

		const addBtn = header.createEl("button", {
			cls: "launchpad-add-btn",
			attr: { "aria-label": t("bookmark.add"), type: "button" },
		});
		setIcon(addBtn, "plus-circle");
		addBtn.addEventListener("click", () => this.host.openCaptureModal());

		// Scrollable content area
		const scrollEl = container.createDiv("launchpad-scroll");

		const collapseState = this.host.getCollapseState();

		if (this.store.uncategorized.length > 0) {
			const section = scrollEl.createDiv("launchpad-uncategorized");
			for (const bm of this.store.uncategorized) {
				this.renderBookmarkItem(section, bm.name, bm.url);
			}
		}

		for (const folder of this.store.folders) {
			this.renderFolder(scrollEl, folder, collapseState, null);
		}

		if (
			this.store.folders.length === 0 &&
			this.store.uncategorized.length === 0
		) {
			scrollEl.createDiv({
				cls: "launchpad-empty",
				text: t("panel.empty"),
			});
		}

		// ── Tabs section ────────────────────────────────────────────────────
		const openTabs = this.host.getOpenTabs();
		const tabsKey = "__tabs__";
		const tabsCollapsed = collapseState[tabsKey] ?? false;

		const tabsFolderEl = scrollEl.createDiv("launchpad-folder launchpad-tabs-folder");

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
		setIcon(tabsIconEl, "layout-grid");
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

		if (openTabs.length === 0) {
			tabsInnerEl.createDiv({ cls: "launchpad-empty", text: t("tabs.empty") });
		} else {
			for (const tab of openTabs) {
				this.renderTabItem(tabsInnerEl, tab);
			}
		}

		// Back link — pinned to the bottom-left of the view
		const previousFilename = this.host.getPreviousFilename();
		if (previousFilename !== null) {
			const backSection = container.createDiv("launchpad-back-section");
			const backLink = backSection.createEl("a", {
				cls: "launchpad-back-item",
				attr: { href: "#", title: `${t("back.ariaLabel")} ${previousFilename}` },
			});
			const backIconEl = backLink.createSpan({ cls: "lp-item-icon", attr: { "aria-hidden": "true" } });
			setIcon(backIconEl, "arrow-left");
			backLink.createSpan({ cls: "lp-item-name", text: previousFilename });
			backLink.addEventListener("click", (e) => {
				e.preventDefault();
				this.host.navigateBack();
			});
		}
	}

	private renderFolder(
		parent: HTMLElement,
		folder: BookmarkFolder,
		collapseState: Record<string, boolean>,
		parentName: string | null
	): void {
		const key = parentName
			? `${parentName}${FOLDER_SEP}${folder.name}`
			: folder.name;
		const isCollapsed = collapseState[key] ?? false;

		const folderEl = parent.createDiv(
			parentName ? "launchpad-subfolder" : "launchpad-folder"
		);

		const headerCls = parentName
			? "launchpad-subfolder-header"
			: "launchpad-folder-header";

		// Use <button> so Enter/Space work for keyboard users; aria-expanded
		// reflects collapse state for screen readers.
		const headerEl = folderEl.createEl("button", {
			cls: headerCls,
			attr: {
				type: "button",
				"aria-expanded": (!isCollapsed).toString(),
			},
		});
		const folderIconEl = headerEl.createSpan({ cls: "lp-folder-icon", attr: { "aria-hidden": "true" } });
		setIcon(folderIconEl, "layers");
		headerEl.createSpan({ text: folder.name });
		// Arrow is last — pushed to the right edge via margin-left: auto in CSS.
		// aria-hidden: decorative; folder name is the accessible label.
		const arrow = headerEl.createSpan({
			cls: "launchpad-folder-arrow" + (isCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const contentEl = folderEl.createDiv(
			parentName
				? "launchpad-subfolder-content"
				: "launchpad-folder-content"
		);
		if (isCollapsed) contentEl.addClass("is-collapsed");

		// Grid-template-rows animation requires a single direct child wrapper.
		const innerEl = contentEl.createDiv("lp-inner");

		headerEl.addEventListener("click", async () => {
			const nowCollapsed = !contentEl.hasClass("is-collapsed");
			contentEl.toggleClass("is-collapsed", nowCollapsed);
			arrow.classList.toggle("collapsed", nowCollapsed);
			headerEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
			await this.host.setCollapseState(key, nowCollapsed);
		});

		for (const bm of folder.bookmarks) {
			this.renderBookmarkItem(innerEl, bm.name, bm.url);
		}

		for (const sub of folder.subfolders) {
			this.renderFolder(innerEl, sub, collapseState, folder.name);
		}
	}

	private renderTabItem(parent: HTMLElement, tab: OpenTab): void {
		const item = parent.createEl("a", {
			cls: "launchpad-item launchpad-tab-item",
			attr: {
				href: "#",
				title: tab.title,
				"aria-label": `${t("tabs.ariaLabel")}: ${tab.title}`,
			},
		});

		const iconEl = item.createSpan({
			cls: "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});

		const iconName =
			tab.type === "markdown"  ? "file-text" :
			tab.type === "pdf"       ? "file-type" :
			tab.type === "canvas"    ? "layout-dashboard" :
			tab.type === "graph"     ? "git-fork" :
			                           "file";

		setIcon(iconEl, iconName);
		item.createSpan({ cls: "lp-item-name", text: tab.title });

		item.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.focusTab(tab.leafId);
		});
	}

	private renderBookmarkItem(
		parent: HTMLElement,
		name: string,
		url: string
	): void {
		const item = parent.createEl("a", {
			cls: "launchpad-item",
			attr: { href: "#", title: url },
		});
		const isVault = url.startsWith("vault://");
		const isNote = url.startsWith("note://");
		const isObsidian = url.startsWith("obsidian://");
		const itemIconEl = item.createSpan({
			cls: isNote ? "lp-item-icon lp-item-icon--note"
				: isVault ? "lp-item-icon lp-item-icon--vault"
				: isObsidian ? "lp-item-icon lp-item-icon--obsidian"
				: "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(itemIconEl, isNote || isVault || isObsidian ? "file-text" : "globe");
		item.createSpan({ cls: "lp-item-name", text: name });
		item.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.openBookmarkUrl(url);
		});
	}
}

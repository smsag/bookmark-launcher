import { App, ItemView, Modal, WorkspaceLeaf, setIcon } from "obsidian";
import { BookmarkFolder, BookmarkStore, LatestFile, OpenTab } from "./types";
import { FOLDER_SEP } from "./BookmarkStore";
import { t } from "./i18n";

function setIconWithFallback(element: HTMLElement, primaryIcon: string, fallbackIcon: string): void {
	try {
		setIcon(element, primaryIcon);
		return;
	} catch {
		// Some icon names are not available on older Obsidian builds; fallback keeps rendering intact.
	}
	try {
		setIcon(element, fallbackIcon);
		return;
	} catch {
		// Final fallback avoids throwing during render so sections still appear even without icons.
	}
	try {
		setIcon(element, "file");
	} catch {
		// No-op: icon is decorative, rendering the section is more important than the icon glyph.
	}
}

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
	/** Returns most recently created files, newest first. */
	getLatestCreatedFiles(): LatestFile[];
	/** Returns most recently modified files, newest first, excluding latest created. */
	getLatestModifiedFiles(): LatestFile[];
	/** Opens a latest file in the active leaf. */
	openLatestFile(path: string): void;
	/** Deletes a latest file by path, moving it to system trash. */
	deleteLatestFile(path: string): Promise<void>;
	/** Whether delete affordance for latest files is enabled. */
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
			// iCloud hydration retries can take seconds; keep a loading state visible to avoid false empty-state signals.
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: "launchpad-loading", text: t("panel.loading") });
		}
	}

	/** Renders the full Launchpad panel from the current store snapshot and UI state. */
	private render(): void {
		// A child wrapper is required because contentEl height does not resolve reliably from a flex parent on all Obsidian platforms.
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

		if (
			this.store.folders.length === 0 &&
			this.store.uncategorized.length === 0
		) {
			scrollContainerEl.createDiv({
				cls: "launchpad-empty",
				text: t("panel.empty"),
			});
		}

		// ── Tabs section ────────────────────────────────────────────────────
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

		if (openTabs.length === 0) {
			tabsInnerEl.createDiv({ cls: "launchpad-empty", text: t("tabs.empty") });
		} else {
			for (const tab of openTabs) {
				this.renderTabItem(tabsInnerEl, tab);
			}
		}

		// ── Latest section ──────────────────────────────────────────────────
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

		this.renderLatestSubsection(
			latestInnerEl,
			collapseState,
			"__latest_created__",
			t("latest.created"),
			"file-plus",
			latestCreated
		);
		this.renderLatestSubsection(
			latestInnerEl,
			collapseState,
			"__latest_modified__",
			t("latest.modified"),
			"file-edit",
			latestModified
		);

		// Keep back navigation pinned to the bottom regardless of list scroll height.
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

	/** Renders a collapsible subsection inside the Latest folder. */
	private renderLatestSubsection(
		containerEl: HTMLElement,
		collapseState: Record<string, boolean>,
		subsectionKey: string,
		label: string,
		iconName: string,
		files: LatestFile[]
	): void {
		const isCollapsed = collapseState[subsectionKey] ?? false;
		const subsectionEl = containerEl.createDiv("launchpad-subfolder");

		const subsectionHeaderEl = subsectionEl.createEl("button", {
			cls: "launchpad-subfolder-header",
			attr: {
				type: "button",
				"aria-expanded": (!isCollapsed).toString(),
			},
		});
		const subsectionIconEl = subsectionHeaderEl.createSpan({
			cls: "lp-folder-icon",
			attr: { "aria-hidden": "true" },
		});
		setIconWithFallback(subsectionIconEl, iconName, "file-text");
		subsectionHeaderEl.createSpan({ text: label });
		const subsectionArrowEl = subsectionHeaderEl.createSpan({
			cls: "launchpad-folder-arrow" + (isCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const subsectionContentEl = subsectionEl.createDiv("launchpad-subfolder-content");
		if (isCollapsed) subsectionContentEl.addClass("is-collapsed");
		const subsectionInnerEl = subsectionContentEl.createDiv("lp-inner");

		subsectionHeaderEl.addEventListener("click", async () => {
			const nowCollapsed = !subsectionContentEl.hasClass("is-collapsed");
			subsectionContentEl.toggleClass("is-collapsed", nowCollapsed);
			subsectionArrowEl.classList.toggle("collapsed", nowCollapsed);
			subsectionHeaderEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
			await this.host.setCollapseState(subsectionKey, nowCollapsed);
		});

		if (files.length === 0) {
			subsectionInnerEl.createDiv({ cls: "launchpad-empty", text: t("latest.empty") });
		} else {
			for (const file of files) {
				this.renderLatestFileItem(subsectionInnerEl, file);
			}
		}
	}

	/** Renders a bookmark folder or subfolder branch with persisted collapse state. */
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

		const folderEl = containerEl.createDiv(
			parentFolderName ? "launchpad-subfolder" : "launchpad-folder"
		);

		const headerClassName = parentFolderName
			? "launchpad-subfolder-header"
			: "launchpad-folder-header";

		// Use a button element so keyboard activation and aria-expanded are handled correctly.
		const headerEl = folderEl.createEl("button", {
			cls: headerClassName,
			attr: {
				type: "button",
				"aria-expanded": (!isCollapsed).toString(),
			},
		});
		const folderIconEl = headerEl.createSpan({ cls: "lp-folder-icon", attr: { "aria-hidden": "true" } });
		setIcon(folderIconEl, "layers");
		headerEl.createSpan({ text: folder.name });
		const arrowEl = headerEl.createSpan({
			cls: "launchpad-folder-arrow" + (isCollapsed ? " collapsed" : ""),
			text: "▾",
			attr: { "aria-hidden": "true" },
		});

		const contentEl = folderEl.createDiv(
			parentFolderName
				? "launchpad-subfolder-content"
				: "launchpad-folder-content"
		);
		if (isCollapsed) contentEl.addClass("is-collapsed");

		const innerEl = contentEl.createDiv("lp-inner");

		headerEl.addEventListener("click", async () => {
			const nowCollapsed = !contentEl.hasClass("is-collapsed");
			contentEl.toggleClass("is-collapsed", nowCollapsed);
			arrowEl.classList.toggle("collapsed", nowCollapsed);
			headerEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
			await this.host.setCollapseState(collapseKey, nowCollapsed);
		});

		for (const bookmark of folder.bookmarks) {
			this.renderBookmarkItem(innerEl, bookmark.name, bookmark.url);
		}

		for (const subfolder of folder.subfolders) {
			this.renderFolder(innerEl, subfolder, collapseState, folder.name);
		}
	}

	/** Renders one open-tab entry in the Tabs section. */
	private renderTabItem(containerEl: HTMLElement, tab: OpenTab): void {
		const itemEl = containerEl.createEl("a", {
			cls: "launchpad-item launchpad-tab-item",
			attr: {
				href: "#",
				title: tab.title,
				"aria-label": `${t("tabs.ariaLabel")}: ${tab.title}`,
			},
		});

		const iconEl = itemEl.createSpan({
			cls: "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});

		const iconName =
			tab.type === "markdown"  ? "file-text" :
			tab.type === "pdf"       ? "file-type" :
			tab.type === "canvas"    ? "layout-dashboard" :
			tab.type === "graph"     ? "git-fork" :
			                           "file";

		setIconWithFallback(iconEl, iconName, "file");
		itemEl.createSpan({ cls: "lp-item-name", text: tab.title });

		itemEl.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.focusTab(tab.leafId);
		});
	}

	/** Renders one latest-file row including optional delete affordance. */
	private renderLatestFileItem(containerEl: HTMLElement, file: LatestFile): void {
		const itemEl = containerEl.createEl("div", {
			cls: "launchpad-item launchpad-latest-item",
			attr: {
				title: file.path,
			},
		});

		const fileLinkEl = itemEl.createEl("a", {
			cls: "launchpad-item-link",
			attr: {
				href: "#",
				"aria-label": `${t("latest.ariaLabel")}: ${file.title}`,
			},
		});
		const iconEl = fileLinkEl.createSpan({
			cls: "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(iconEl, "file-text");
		fileLinkEl.createSpan({ cls: "lp-item-name", text: file.title });
		fileLinkEl.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.openLatestFile(file.path);
		});

		if (this.host.isDeleteEnabled()) {
			const deleteButtonEl = itemEl.createEl("button", {
				cls: "launchpad-delete-btn",
				attr: {
					type: "button",
					"aria-label": `${t("latest.delete.ariaLabel")}: ${file.title}`,
				},
			});
			const trashIconEl = deleteButtonEl.createSpan({
				attr: { "aria-hidden": "true" },
			});
			setIcon(trashIconEl, "trash-2");
			deleteButtonEl.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				new ConfirmDeleteModal(
					this.app,
					file.title,
					() => this.host.deleteLatestFile(file.path)
				).open();
			});
		}
	}

	/** Renders one bookmark row in uncategorized, folder, or subfolder lists. */
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
		const iconName =
			isNote || isObsidian ? "file-text" :   // file/note navigation
			isVault              ? "library"   :   // folder navigation
			                       "globe";        // external web link
		setIcon(itemIconEl, iconName);
		itemEl.createSpan({ cls: "lp-item-name", text: name });
		itemEl.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.openBookmarkUrl(url);
		});
	}
}

class ConfirmDeleteModal extends Modal {
	private filename: string;
	private onConfirm: () => Promise<void> | void;

	constructor(app: App, filename: string, onConfirm: () => Promise<void> | void) {
		super(app);
		this.filename = filename;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("launchpad-confirm-modal");

		contentEl.createEl("h3", {
			text: t("latest.delete.confirmTitle"),
		});
		contentEl.createEl("p", {
			text: t("latest.delete.confirmMessage").replace("{filename}", this.filename),
		});

		const actions = contentEl.createDiv("launchpad-capture-actions");

		const cancelBtn = actions.createEl("button", {
			attr: { type: "button" },
			text: t("latest.delete.cancel"),
		});
		const confirmBtn = actions.createEl("button", {
			cls: "mod-warning",
			attr: { type: "button" },
			text: t("latest.delete.confirm"),
		});

		cancelBtn.addEventListener("click", () => this.close());
		confirmBtn.addEventListener("click", () => {
			// Keep modal closing deterministic while still surfacing async failures in logs.
			void Promise.resolve(this.onConfirm()).catch((error) => {
				console.error("Launchpad: failed to delete latest file", error);
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { BookmarkFolder, BookmarkStore } from "./types";
import { FOLDER_SEP } from "./BookmarkStore";

export const VIEW_TYPE_BOOKMARK = "launchpad-view";

export interface BookmarkViewHost {
	openCaptureModal(): void;
	getCollapseState(): Record<string, boolean>;
	setCollapseState(key: string, collapsed: boolean): Promise<void>;
	/** Open a bookmark URL; captures the active file for obsidian:// links. */
	openBookmarkUrl(url: string): void;
	/** Returns the basename of the file to navigate back to, or null. */
	getPreviousFilename(): string | null;
	/** Navigate back to the captured file and clear the back-link. */
	navigateBack(): Promise<void>;
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
		return "bookmark";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		// nothing to clean up
	}

	setStore(store: BookmarkStore): void {
		this.store = store;
		this.render();
	}

	private render(): void {
		// BUG-9 fix: use the ItemView.contentEl getter (the stable Obsidian API
		// for the content pane) instead of indexing into containerEl.children[].
		// We clear contentEl and create a wrapper div inside it (not on contentEl
		// itself). This is critical: Obsidian's .view-content element already has
		// its height flex-determined by the workspace layout. Setting height: 100%
		// directly on contentEl via a class can fail to resolve correctly, making
		// the flex children (launchpad-scroll) collapse to zero height and hiding
		// all bookmarks. A child div's height: 100% resolves correctly against the
		// parent's flex-determined height.
		this.contentEl.empty();
		this.contentEl.addClass("launchpad-content-el");
		const container = this.contentEl.createDiv("launchpad-container");
		container.setAttribute("role", "navigation");
		container.setAttribute("aria-label", "Launchpad");

		const header = container.createDiv("launchpad-header");
		header.createSpan({ text: "Bookmarks" });
		const addBtn = header.createEl("button", {
			cls: "launchpad-add-btn",
			text: "+",
			attr: { "aria-label": "Add bookmark" },
		});
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
				text: 'No bookmarks yet. Press + to add one, or edit bookmarks.md directly.',
			});
		}

		// Back link — pinned to the bottom-left of the view
		const previousFilename = this.host.getPreviousFilename();
		if (previousFilename !== null) {
			const backSection = container.createDiv("launchpad-back-section");
			const backLink = backSection.createEl("a", {
				cls: "launchpad-back-item",
				attr: { href: "#", title: `Go back to ${previousFilename}` },
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
		// BUG-7 fix: use FOLDER_SEP (\x1F) instead of "/" so that folder names
		// which themselves contain a slash don't produce colliding keys.
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

		// Use <button> so Enter/Space work automatically for keyboard users.
		// aria-expanded reflects current collapse state for screen readers.
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
			// Keep aria-expanded in sync so AT users hear the new state.
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
		const itemIconEl = item.createSpan({
			cls: isVault ? "lp-item-icon lp-item-icon--vault" : "lp-item-icon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(itemIconEl, isVault ? "library" : "globe");
		item.createSpan({ cls: "lp-item-name", text: name });
		item.addEventListener("click", (e) => {
			e.preventDefault();
			this.host.openBookmarkUrl(url);
		});
	}
}

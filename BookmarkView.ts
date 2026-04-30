import { ItemView, WorkspaceLeaf } from "obsidian";
import { BookmarkFolder, BookmarkStore } from "./types";
import { FOLDER_SEP } from "./BookmarkStore";

export const VIEW_TYPE_BOOKMARK = "launchpad-view";

export interface BookmarkViewHost {
	openCaptureModal(): void;
	getCollapseState(): Record<string, boolean>;
	setCollapseState(key: string, collapsed: boolean): Promise<void>;
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
		const container = this.contentEl;
		container.empty();
		container.addClass("launchpad-container");

		const header = container.createDiv("launchpad-header");
		header.createSpan({ text: "Bookmarks" });
		const addBtn = header.createEl("button", {
			cls: "launchpad-add-btn",
			text: "+",
			attr: { "aria-label": "Add bookmark" },
		});
		addBtn.addEventListener("click", () => this.host.openCaptureModal());

		const collapseState = this.host.getCollapseState();

		if (this.store.uncategorized.length > 0) {
			const section = container.createDiv("launchpad-uncategorized");
			for (const bm of this.store.uncategorized) {
				this.renderBookmarkItem(section, bm.name, bm.url);
			}
		}

		for (const folder of this.store.folders) {
			this.renderFolder(container, folder, collapseState, null);
		}

		if (
			this.store.folders.length === 0 &&
			this.store.uncategorized.length === 0
		) {
			container.createDiv({
				cls: "launchpad-empty",
				text: 'No bookmarks yet. Press + to add one, or edit bookmarks.md directly.',
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

		const headerEl = folderEl.createDiv(headerCls);
		const arrow = headerEl.createSpan({
			cls: "launchpad-folder-arrow" + (isCollapsed ? " collapsed" : ""),
			text: "▾",
		});
		headerEl.createSpan({ text: folder.name });

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
			text: name,
			attr: { href: "#", title: url },
		});
		item.addEventListener("click", (e) => {
			e.preventDefault();
			// Allowlist URL schemes — reject anything not explicitly safe.
			// bookmarks.md is user-editable plain text, so a url value arriving
			// here may differ from what was entered via the modal (which validates
			// on input). Without this guard, a `javascript:` URI in the file
			// would execute in Obsidian's Electron renderer with Node.js access.
			if (url.startsWith("obsidian://")) {
				window.open(url);
			} else if (url.startsWith("https://") || url.startsWith("http://")) {
				window.open(url, "_blank", "noopener,noreferrer");
			}
			// Any other scheme (javascript:, file:, data:, …) is silently ignored.
		});
	}
}

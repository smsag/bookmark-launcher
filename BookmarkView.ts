import { ItemView, WorkspaceLeaf } from "obsidian";
import { BookmarkFolder, BookmarkStore } from "./types";

export const VIEW_TYPE_BOOKMARK = "bookmark-launcher-view";

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
		return "Bookmark Launcher";
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
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("bookmark-launcher-container");

		const header = container.createDiv("bookmark-launcher-header");
		header.createSpan({ text: "Bookmarks" });
		const addBtn = header.createEl("button", {
			cls: "bookmark-launcher-add-btn",
			text: "+",
			attr: { "aria-label": "Add bookmark" },
		});
		addBtn.addEventListener("click", () => this.host.openCaptureModal());

		const collapseState = this.host.getCollapseState();

		if (this.store.uncategorized.length > 0) {
			const section = container.createDiv("bookmark-launcher-uncategorized");
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
				cls: "bookmark-launcher-empty",
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
		const key = parentName ? `${parentName}/${folder.name}` : folder.name;
		const isCollapsed = collapseState[key] ?? false;

		const folderEl = parent.createDiv(
			parentName ? "bookmark-launcher-subfolder" : "bookmark-launcher-folder"
		);

		const headerCls = parentName
			? "bookmark-launcher-subfolder-header"
			: "bookmark-launcher-folder-header";

		const headerEl = folderEl.createDiv(headerCls);
		const arrow = headerEl.createSpan({
			cls: "bookmark-launcher-folder-arrow" + (isCollapsed ? " collapsed" : ""),
			text: "▾",
		});
		headerEl.createSpan({ text: folder.name });

		const contentEl = folderEl.createDiv(
			parentName
				? "bookmark-launcher-subfolder-content"
				: "bookmark-launcher-folder-content"
		);
		contentEl.style.display = isCollapsed ? "none" : "";

		headerEl.addEventListener("click", async () => {
			const nowCollapsed = contentEl.style.display !== "none";
			contentEl.style.display = nowCollapsed ? "none" : "";
			arrow.classList.toggle("collapsed", nowCollapsed);
			await this.host.setCollapseState(key, nowCollapsed);
		});

		for (const bm of folder.bookmarks) {
			this.renderBookmarkItem(contentEl, bm.name, bm.url);
		}

		for (const sub of folder.subfolders) {
			this.renderFolder(contentEl, sub, collapseState, folder.name);
		}
	}

	private renderBookmarkItem(
		parent: HTMLElement,
		name: string,
		url: string
	): void {
		const item = parent.createEl("a", {
			cls: "bookmark-launcher-item",
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

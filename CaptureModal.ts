import { App, Modal, Setting } from "obsidian";
import { Bookmark, FolderOption } from "./types";
import { BookmarkStoreManager } from "./BookmarkStore";

const NEW_FOLDER_VALUE = "__new__";
const UNCATEGORIZED_VALUE = "__uncategorized__";
const URL_PREFIXES = ["https://", "http://", "obsidian://"];

export class CaptureModal extends Modal {
	private store: BookmarkStoreManager;
	private folderOptions: FolderOption[];

	constructor(app: App, store: BookmarkStoreManager, folderOptions: FolderOption[]) {
		super(app);
		this.store = store;
		this.folderOptions = folderOptions;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("bookmark-capture-modal");
		contentEl.createEl("h2", { text: "Add Bookmark" });

		let nameValue = "";
		let urlValue = "";
		let folderValue =
			this.folderOptions.length > 0 ? this.folderOptions[0].value : UNCATEGORIZED_VALUE;
		let newFolderValue = "";
		let urlError = "";
		let nameError = "";

		// --- Display Name ---
		const nameField = contentEl.createDiv("bookmark-capture-field");
		nameField.createEl("label", { text: "Display Name" });
		const nameInput = nameField.createEl("input", {
			attr: { type: "text", placeholder: "e.g. Linear Board" },
		});
		const nameErrorEl = nameField.createDiv({
			cls: "bookmark-capture-error",
			text: "",
		});
		nameInput.style.width = "100%";

		// --- URL ---
		const urlField = contentEl.createDiv("bookmark-capture-field");
		urlField.createEl("label", { text: "URL" });
		const urlInput = urlField.createEl("input", {
			attr: {
				type: "text",
				placeholder: "https:// or obsidian://",
			},
		});
		const urlErrorEl = urlField.createDiv({
			cls: "bookmark-capture-error",
			text: "",
		});
		urlInput.style.width = "100%";

		// --- Target Folder ---
		const folderField = contentEl.createDiv("bookmark-capture-field");
		folderField.createEl("label", { text: "Target Folder" });
		const folderSelect = folderField.createEl("select");
		folderSelect.style.width = "100%";

		if (this.folderOptions.length === 0) {
			const opt = folderSelect.createEl("option", {
				text: "Uncategorized",
				attr: { value: UNCATEGORIZED_VALUE },
			});
			opt.selected = true;
		} else {
			for (const opt of this.folderOptions) {
				folderSelect.createEl("option", {
					text: opt.label,
					attr: { value: opt.value },
				});
			}
		}
		folderSelect.createEl("option", {
			text: "+ New folder…",
			attr: { value: NEW_FOLDER_VALUE },
		});

		// --- New Folder Name (hidden until selected) ---
		const newFolderField = contentEl.createDiv("bookmark-capture-field");
		newFolderField.style.display = "none";
		newFolderField.createEl("label", { text: "New Folder Name" });
		const newFolderInput = newFolderField.createEl("input", {
			attr: { type: "text", placeholder: "Folder name" },
		});
		newFolderInput.style.width = "100%";

		folderSelect.addEventListener("change", () => {
			folderValue = folderSelect.value;
			newFolderField.style.display =
				folderValue === NEW_FOLDER_VALUE ? "" : "none";
			updateSaveBtn();
		});

		newFolderInput.addEventListener("input", () => {
			newFolderValue = newFolderInput.value.trim();
			updateSaveBtn();
		});

		// --- Actions ---
		const actions = contentEl.createDiv("bookmark-capture-actions");
		const cancelBtn = actions.createEl("button", { text: "Cancel" });
		const saveBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: "Save",
		});

		const updateSaveBtn = () => {
			const nameOk = nameValue.trim().length > 0;
			const urlOk = URL_PREFIXES.some((p) => urlValue.trim().startsWith(p));
			const folderOk =
				folderValue !== NEW_FOLDER_VALUE ||
				newFolderValue.trim().length > 0;
			saveBtn.disabled = !(nameOk && urlOk && folderOk);
		};

		nameInput.addEventListener("input", () => {
			nameValue = nameInput.value;
			nameErrorEl.textContent =
				nameValue.trim().length === 0 ? "Name is required." : "";
			updateSaveBtn();
		});

		urlInput.addEventListener("input", () => {
			urlValue = urlInput.value;
			const valid = URL_PREFIXES.some((p) => urlValue.trim().startsWith(p));
			urlErrorEl.textContent = valid
				? ""
				: "URL must start with https://, http://, or obsidian://";
			updateSaveBtn();
		});

		cancelBtn.addEventListener("click", () => this.close());

		saveBtn.addEventListener("click", async () => {
			const name = nameValue.trim();
			const url = urlValue.trim();
			const isNew = folderValue === NEW_FOLDER_VALUE;
			const targetFolder = isNew
				? newFolderValue.trim()
				: folderValue === UNCATEGORIZED_VALUE
				? ""
				: folderValue;

			if (!name || !URL_PREFIXES.some((p) => url.startsWith(p))) return;
			if (isNew && !targetFolder) return;

			const bm: Bookmark = { name, url };
			await this.store.addBookmark(bm, targetFolder, isNew);
			this.close();
		});

		updateSaveBtn();

		// Keyboard handling
		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === "Enter" && !saveBtn.disabled) {
				saveBtn.click();
			}
		};
		nameInput.addEventListener("keydown", handleKeydown);
		urlInput.addEventListener("keydown", handleKeydown);
		newFolderInput.addEventListener("keydown", handleKeydown);

		nameInput.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

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
		contentEl.addClass("launchpad-capture-modal");
		contentEl.createEl("h2", { text: "Add Bookmark" });

		let nameValue = "";
		let urlValue = "";
		let folderValue =
			this.folderOptions.length > 0 ? this.folderOptions[0].value : UNCATEGORIZED_VALUE;
		let newFolderValue = "";

		// --- Display Name ---
		const nameField = contentEl.createDiv("launchpad-capture-field");
		const nameLbl = nameField.createEl("label", { text: "Display Name" });
		nameLbl.setAttribute("for", "lp-cm-name");
		const nameInput = nameField.createEl("input", {
			attr: {
				id: "lp-cm-name",
				type: "text",
				placeholder: "e.g. Linear Board",
				"aria-describedby": "lp-cm-name-err",
			},
		});
		// aria-live="polite" ensures screen readers announce validation messages
		// as they appear without interrupting the current reading position.
		const nameErrorEl = nameField.createDiv({
			cls: "launchpad-capture-error",
			text: "",
			attr: { id: "lp-cm-name-err", "aria-live": "polite" },
		});
		nameInput.style.width = "100%";

		// --- URL ---
		const urlField = contentEl.createDiv("launchpad-capture-field");
		const urlLbl = urlField.createEl("label", { text: "URL" });
		urlLbl.setAttribute("for", "lp-cm-url");
		const urlInput = urlField.createEl("input", {
			attr: {
				id: "lp-cm-url",
				type: "text",
				placeholder: "https:// or obsidian://",
				"aria-describedby": "lp-cm-url-err",
			},
		});
		const urlErrorEl = urlField.createDiv({
			cls: "launchpad-capture-error",
			text: "",
			attr: { id: "lp-cm-url-err", "aria-live": "polite" },
		});
		urlInput.style.width = "100%";

		// --- Target Folder ---
		const folderField = contentEl.createDiv("launchpad-capture-field");
		const folderLbl = folderField.createEl("label", { text: "Target Folder" });
		folderLbl.setAttribute("for", "lp-cm-folder");
		const folderSelect = folderField.createEl("select", {
			attr: { id: "lp-cm-folder" },
		});
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
		const newFolderField = contentEl.createDiv("launchpad-capture-field");
		newFolderField.style.display = "none";
		const newFolderLbl = newFolderField.createEl("label", { text: "New Folder Name" });
		newFolderLbl.setAttribute("for", "lp-cm-new-folder");
		const newFolderInput = newFolderField.createEl("input", {
			attr: { id: "lp-cm-new-folder", type: "text", placeholder: "Folder name" },
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
		const actions = contentEl.createDiv("launchpad-capture-actions");
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
			// BUG-5 fix: disable immediately to prevent double-submit via rapid
			// Enter presses or double-clicks before the async write completes.
			if (saveBtn.disabled) return;
			saveBtn.disabled = true;

			const name = nameValue.trim();
			const url = urlValue.trim();
			const isNew = folderValue === NEW_FOLDER_VALUE;
			const targetFolder = isNew
				? newFolderValue.trim()
				: folderValue === UNCATEGORIZED_VALUE
				? ""
				: folderValue;

			if (!name || !URL_PREFIXES.some((p) => url.startsWith(p))) {
				saveBtn.disabled = false;
				return;
			}
			if (isNew && !targetFolder) {
				saveBtn.disabled = false;
				return;
			}

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

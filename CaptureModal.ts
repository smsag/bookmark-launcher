import { App, Modal, Setting } from "obsidian";
import { Bookmark, FolderOption } from "./types";
import { BookmarkStoreManager } from "./BookmarkStore";
import { t } from "./i18n";

const NEW_FOLDER_VALUE = "__new__";
const UNCATEGORIZED_VALUE = "__uncategorized__";
const URL_PREFIXES = ["https://", "http://", "obsidian://", "vault://", "note://"];

/** Returns true for [[wiki link]] syntax, which the modal accepts as shorthand for note:// links. */
function isWikiLink(val: string): boolean {
	return val.startsWith("[[") && val.endsWith("]]") && val.length > 4;
}

/** Normalizes [[wiki link]] input to the stored note:// scheme. Plain URLs are returned as-is. */
function normalizeUrl(val: string): string {
	if (isWikiLink(val)) return "note://" + val.slice(2, -2).trim();
	return val;
}

export class CaptureModal extends Modal {
	private store: BookmarkStoreManager;
	private getFolderOptions: () => FolderOption[];

	constructor(app: App, store: BookmarkStoreManager, getFolderOptions: () => FolderOption[]) {
		super(app);
		this.store = store;
		this.getFolderOptions = getFolderOptions;
	}

	onOpen(): void {
		const { contentEl } = this;
		// Query folder options at open time so newly added folders appear.
		const folderOptions = this.getFolderOptions();
		contentEl.addClass("launchpad-capture-modal");
		new Setting(contentEl).setName(t("modal.heading")).setHeading();

		let nameValue = "";
		let urlValue = "";
		let folderValue =
			folderOptions.length > 0 ? folderOptions[0].value : UNCATEGORIZED_VALUE;
		let newFolderValue = "";

		// --- Display Name ---
		const nameField = contentEl.createDiv("launchpad-capture-field");
		const nameLbl = nameField.createEl("label", { text: t("modal.name.label") });
		nameLbl.setAttribute("for", "lp-cm-name");
		const nameInput = nameField.createEl("input", {
			attr: {
				id: "lp-cm-name",
				type: "text",
				placeholder: t("modal.name.placeholder"),
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

		// --- URL ---
		const urlField = contentEl.createDiv("launchpad-capture-field");
		const urlLbl = urlField.createEl("label", { text: t("modal.url.label") });
		urlLbl.setAttribute("for", "lp-cm-url");
		const urlInput = urlField.createEl("input", {
			attr: {
				id: "lp-cm-url",
				type: "text",
				placeholder: t("modal.url.placeholder"),
				"aria-describedby": "lp-cm-url-err",
			},
		});
		const urlErrorEl = urlField.createDiv({
			cls: "launchpad-capture-error",
			text: "",
			attr: { id: "lp-cm-url-err", "aria-live": "polite" },
		});

		// --- Target folder ---
		const folderField = contentEl.createDiv("launchpad-capture-field");
		const folderLbl = folderField.createEl("label", { text: t("modal.folder.label") });
		folderLbl.setAttribute("for", "lp-cm-folder");
		const folderSelect = folderField.createEl("select", {
			attr: { id: "lp-cm-folder" },
		});

		if (folderOptions.length === 0) {
			const opt = folderSelect.createEl("option", {
				text: t("modal.folder.uncategorized"),
				attr: { value: UNCATEGORIZED_VALUE },
			});
			opt.selected = true;
		} else {
			for (const opt of folderOptions) {
				folderSelect.createEl("option", {
					text: opt.label,
					attr: { value: opt.value },
				});
			}
		}
		folderSelect.createEl("option", {
			text: t("modal.folder.new"),
			attr: { value: NEW_FOLDER_VALUE },
		});

		// --- New folder name (hidden until selected) ---
		const newFolderField = contentEl.createDiv("launchpad-capture-field launchpad-hidden");
		const newFolderLbl = newFolderField.createEl("label", { text: t("modal.newFolder.label") });
		newFolderLbl.setAttribute("for", "lp-cm-new-folder");
		const newFolderInput = newFolderField.createEl("input", {
			attr: { id: "lp-cm-new-folder", type: "text", placeholder: t("modal.newFolder.placeholder") },
		});

		folderSelect.addEventListener("change", () => {
			folderValue = folderSelect.value;
			newFolderField.toggleClass("launchpad-hidden", folderValue !== NEW_FOLDER_VALUE);
			updateSaveBtn();
		});

		newFolderInput.addEventListener("input", () => {
			newFolderValue = newFolderInput.value.trim();
			updateSaveBtn();
		});

		// --- Actions ---
		const actions = contentEl.createDiv("launchpad-capture-actions");
		const cancelBtn = actions.createEl("button", { text: t("modal.cancel") });
		const saveBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: t("modal.save"),
		});
		// Keep save errors inline so iOS write failures don't look like freezes.
		const saveErrorEl = contentEl.createDiv({
			cls: "launchpad-capture-error",
			text: "",
			attr: { "aria-live": "polite" },
		});

		const updateSaveBtn = () => {
			const nameOk = nameValue.trim().length > 0;
			const urlOk = URL_PREFIXES.some((p) => urlValue.trim().startsWith(p))
				|| isWikiLink(urlValue.trim());
			const folderOk =
				folderValue !== NEW_FOLDER_VALUE ||
				newFolderValue.trim().length > 0;
			saveBtn.disabled = !(nameOk && urlOk && folderOk);
		};

		nameInput.addEventListener("input", () => {
			nameValue = nameInput.value;
			nameErrorEl.textContent =
				nameValue.trim().length === 0 ? t("modal.name.error") : "";
			updateSaveBtn();
		});

		urlInput.addEventListener("input", () => {
			urlValue = urlInput.value;
			const valid = URL_PREFIXES.some((p) => urlValue.trim().startsWith(p))
				|| isWikiLink(urlValue.trim());
			urlErrorEl.textContent = valid
				? ""
				: t("modal.url.error");
			updateSaveBtn();
		});

		cancelBtn.addEventListener("click", () => this.close());

		saveBtn.addEventListener("click", async () => {
			if (saveBtn.disabled) return;
			saveBtn.disabled = true;
			saveErrorEl.textContent = "";

			const name = nameValue.trim();
			const url = normalizeUrl(urlValue.trim());
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

			try {
				const bm: Bookmark = { name, url };
				await this.store.addBookmark(bm, targetFolder, isNew);
				this.close();
			} catch (err) {
				saveBtn.disabled = false;
				console.error("Launchpad: failed to save bookmark", err);
				saveErrorEl.textContent = t("modal.saveError");
			}
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

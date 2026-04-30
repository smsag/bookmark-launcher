import { App, Modal, TFolder } from "obsidian";

/**
 * Shown on first launch (or when the bookmarks file cannot be found).
 * Lets the user pick a vault-relative path for their bookmarks file.
 * Dismissing without saving leaves bookmarksFilePath as null; the user
 * can re-open this modal via the "Configure file location" command.
 */
export class SetupModal extends Modal {
	private onConfirm: (path: string) => Promise<void>;

	constructor(app: App, onConfirm: (path: string) => Promise<void>) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("launchpad-setup-modal");

		contentEl.createEl("h2", { text: "Set up Launchpad" });
		contentEl.createEl("p", {
			cls: "launchpad-setup-description",
			text: "Choose where to store your bookmarks file. You can place it anywhere inside your vault — it stays a plain Markdown file you can edit directly.",
		});

		// ── Path input ────────────────────────────────────────────────────
		let pathValue = "bookmarks.md";

		const pathField = contentEl.createDiv("launchpad-capture-field");
		pathField.createEl("label", { text: "File path (relative to vault root)" });

		const pathInput = pathField.createEl("input", {
			attr: {
				type: "text",
				placeholder: "bookmarks.md  or  Resources/bookmarks.md",
			},
		});
		pathInput.value = pathValue;
		pathInput.style.width = "100%";

		const errorEl = pathField.createDiv({ cls: "launchpad-capture-error", text: "" });

		// ── Folder chips ──────────────────────────────────────────────────
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path !== "/")
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 8); // show at most 8 to keep the modal compact

		if (folders.length > 0) {
			const hintRow = pathField.createDiv("launchpad-setup-hint");
			hintRow.createSpan({ cls: "launchpad-setup-hint-label", text: "Folders: " });
			for (const folder of folders) {
				const chip = hintRow.createEl("button", {
					cls: "launchpad-setup-chip",
					text: folder.path,
					attr: { type: "button" },
				});
				chip.addEventListener("click", () => {
					// Keep whatever filename is already in the input
					const filename =
						pathInput.value.trim().split("/").pop() || "bookmarks.md";
					pathInput.value = `${folder.path}/${filename}`;
					pathValue = pathInput.value;
					errorEl.textContent = validate(pathValue);
					confirmBtn.disabled = !!validate(pathValue);
					pathInput.focus();
				});
			}
		}

		// ── Validation ────────────────────────────────────────────────────
		const validate = (val: string): string => {
			const v = val.trim();
			if (!v) return "Path is required.";
			if (!v.endsWith(".md")) return "File must end with .md";
			if (v.startsWith("/")) return "Use a relative path — no leading slash.";
			if (v.includes("..")) return "Path cannot contain ..";
			return "";
		};

		pathInput.addEventListener("input", () => {
			pathValue = pathInput.value;
			errorEl.textContent = validate(pathValue);
			confirmBtn.disabled = !!validate(pathValue);
		});

		// ── Actions ───────────────────────────────────────────────────────
		const actions = contentEl.createDiv("launchpad-capture-actions");

		const cancelBtn = actions.createEl("button", { text: "Later" });
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: "Create file",
		});
		confirmBtn.addEventListener("click", async () => {
			const err = validate(pathValue.trim());
			if (err) { errorEl.textContent = err; return; }
			confirmBtn.disabled = true;
			confirmBtn.setText("Creating…");
			await this.onConfirm(pathValue.trim());
			this.close();
		});

		// Enter to confirm, Esc to dismiss (Obsidian handles Esc via Modal)
		pathInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !confirmBtn.disabled) confirmBtn.click();
		});

		pathInput.focus();
		pathInput.select();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

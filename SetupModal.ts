import { App, Modal, Setting, TFolder, normalizePath } from "obsidian";

/**
 * Shown on first launch or when the user wants to change the bookmarks file.
 * Pass `currentPath` to pre-fill the input and switch to reconfigure wording.
 * Dismissing without saving leaves bookmarksFilePath unchanged; the user
 * can re-open this modal via the header gear button or the command palette.
 */
export class SetupModal extends Modal {
	private onConfirm: (path: string) => Promise<void>;
	private currentPath: string | null;

	constructor(
		app: App,
		onConfirm: (path: string) => Promise<void>,
		currentPath?: string | null,
	) {
		super(app);
		this.onConfirm = onConfirm;
		this.currentPath = currentPath ?? null;
	}

	onOpen(): void {
		const { contentEl } = this;
		const isReconfigure = this.currentPath !== null;
		contentEl.addClass("launchpad-setup-modal");
		new Setting(contentEl)
			.setName(isReconfigure ? "Change bookmarks file" : "Set up Launchpad")
			.setHeading();
		contentEl.createEl("p", {
			cls: "launchpad-setup-description",
			text: isReconfigure
				? "Enter the vault-relative path of the Markdown file you want to use. The file will be created if it does not exist yet."
				: "Choose where to store your bookmarks file. You can place it anywhere inside your vault — it stays a plain Markdown file you can edit directly.",
		});

		// ── Path input ────────────────────────────────────────────────────
		let pathValue = this.currentPath ?? "bookmarks.md";

		const pathField = contentEl.createDiv("launchpad-capture-field");
		const pathLbl = pathField.createEl("label", { text: "File path (relative to vault root)" });
		pathLbl.setAttribute("for", "lp-sm-path");

		const pathInput = pathField.createEl("input", {
			attr: {
				id: "lp-sm-path",
				type: "text",
				placeholder: "bookmarks.md  or  Resources/bookmarks.md",
				"aria-describedby": "lp-sm-path-err",
			},
		});
		pathInput.value = pathValue;
		if (isReconfigure) pathInput.select();

		// aria-live="polite" so screen readers announce validation messages
		// without interrupting the current reading flow.
		const errorEl = pathField.createDiv({
			cls: "launchpad-capture-error",
			text: "",
			attr: { id: "lp-sm-path-err", "aria-live": "polite" },
		});

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
			// Block null bytes and other ASCII control characters, which some
			// file-systems treat specially or which could bypass the checks above.
			if (/[\x00-\x1f\x7f]/.test(v)) return "Path contains invalid characters.";
			return "";
		};

		pathInput.addEventListener("input", () => {
			pathValue = pathInput.value;
			errorEl.textContent = validate(pathValue);
			confirmBtn.disabled = !!validate(pathValue);
		});

		// ── Actions ───────────────────────────────────────────────────────
		const actions = contentEl.createDiv("launchpad-capture-actions");

		const cancelBtn = actions.createEl("button", { text: isReconfigure ? "Cancel" : "Later" });
		cancelBtn.addEventListener("click", () => this.close());

		const confirmLabel = isReconfigure ? "Save" : "Create file";
		const confirmBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: confirmLabel,
		});
		confirmBtn.addEventListener("click", async () => {
			const err = validate(pathValue.trim());
			if (err) { errorEl.textContent = err; return; }
			confirmBtn.disabled = true;
			confirmBtn.setText(isReconfigure ? "Saving…" : "Creating…");
			try {
				await this.onConfirm(normalizePath(pathValue.trim()));
				this.close();
			} catch (e) {
				errorEl.textContent = e instanceof Error ? e.message : String(e);
				confirmBtn.disabled = false;
				confirmBtn.setText(confirmLabel);
			}
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

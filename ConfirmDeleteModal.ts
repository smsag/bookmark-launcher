import { App, Modal } from "obsidian";
import { t } from "./i18n";

/** Confirmation dialog shown before moving a Latest file to system trash. */
export class ConfirmDeleteModal extends Modal {
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

		contentEl.createEl("h3", { text: t("latest.delete.confirmTitle") });
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

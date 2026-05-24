export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basis = "";
	basename = "";
	extension = "md";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class App {
	vault: Record<string, unknown> = {};
	workspace: Record<string, unknown> = {};
	metadataCache: Record<string, unknown> = {};
	setting?: Record<string, unknown>;
}

export class Notice {
	constructor(_message: string) {}
}

export class Plugin {
	app = new App();
	manifest = { id: "launchpad" };
}

export class WorkspaceLeaf {}

export class ItemView {
	contentEl = {
		empty() {},
		addClass(_value: string) {},
		createDiv(_value?: unknown) {
			return {
				createDiv() { return this; },
				createEl() { return this; },
				createSpan() { return this; },
				setAttribute() {},
				addClass() {},
				empty() {},
			};
		},
	};

	constructor(_leaf: WorkspaceLeaf) {}
	getViewType(): string { return ""; }
	getDisplayText(): string { return ""; }
	getIcon(): string { return ""; }
}

export class Modal {
	contentEl = { empty() {}, createDiv() { return this; }, createEl() { return this; } };
	titleEl = { setText(_value: string) {} };
	constructor(_app: App) {}
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}

export class PluginSettingTab {
	containerEl = { empty() {} };
	constructor(_app: App, _plugin: Plugin) {}
	display(): void {}
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setName(_value: string) { return this; }
	setDesc(_value: string) { return this; }
	addToggle(callback: (toggle: { setValue: (value: boolean) => { onChange: (cb: (value: boolean) => unknown) => unknown } }) => unknown) {
		callback({
			setValue() {
				return { onChange() {} };
			},
		});
		return this;
	}
	addText(callback: (text: { setPlaceholder: (value: string) => { setValue: (value: string) => { onChange: (cb: (value: string) => unknown) => unknown } } }) => unknown) {
		callback({
			setPlaceholder() {
				return {
					setValue() {
						return { onChange() {} };
					},
				};
			},
		});
		return this;
	}
}

export function setIcon(_el: unknown, _icon: string): void {}
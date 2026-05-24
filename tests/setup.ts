const localStorageStub = {
	getItem(_key: string): string | null {
		return "en";
	},
	setItem(_key: string, _value: string): void {},
	removeItem(_key: string): void {},
	clear(): void {},
};

Object.defineProperty(globalThis, "window", {
	value: { localStorage: localStorageStub },
	writable: true,
	configurable: true,
});
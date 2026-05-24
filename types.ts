export interface Bookmark {
	name: string;
	url: string;
}

export interface BookmarkFolder {
	name: string;
	bookmarks: Bookmark[];
	subfolders: BookmarkFolder[];
}

export interface BookmarkStore {
	folders: BookmarkFolder[];
	uncategorized: Bookmark[];
}

export interface FolderOption {
	label: string;
	value: string;
	isSubfolder: boolean;
}

export interface OpenTab {
	title: string;
	type: string;
	leafId: string;
}

export interface LatestFile {
	title: string;
	path: string;
	ctime: number;
	mtime: number;
}

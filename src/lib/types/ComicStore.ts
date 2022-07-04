import { Comic, type Bubble } from "./Comic";
import { baseNameExt, resolveFile, supportedImageTypes } from "./funcs";

export interface ComicStore {
    list(): Promise<Comic[]>;
    getImageUrl(c: Comic): Promise<string>;
    getBubbles(c: Comic, language?: string): Promise<Bubble[]>;
}

export interface UpdatableComicStore extends ComicStore {
    update(c: Comic): boolean;
}

export class DirectoryComicStore implements ComicStore {
    private readonly dir: FileSystemDirectoryHandle;

    constructor(dir: FileSystemDirectoryHandle) {
        this.dir = dir;
    }

    async list(): Promise<Comic[]> {
        let comics: Comic[] = [];
        await this._list(this.dir, comics);
        return comics;
    }

    private async _list(d: FileSystemDirectoryHandle, comics: Comic[]) {
        let cbase = "";
        let c: Comic = { path: "", languages: [] };
        for await (const [name, entry] of d) {
            // Get the entry's full path
            let path = (await this.dir.resolve(entry))?.join("/");
            if (path) {
                let [base, ext] = baseNameExt(path);
                if (entry.kind === 'file' && !supportedImageTypes.includes(ext) && ext !== "bbl") {
                    // Skip files that are not images or .bbl files
                    continue;
                }
                let lang = null;
                if (ext === "bbl") {
                    [base, lang] = baseNameExt(base);
                }
                if (cbase !== base) {
                    cbase = base;
                    c = new Comic("", [], this);
                    comics.push(c);
                }
                if (lang != null) {
                    c.languages?.push(lang);
                }
                if (ext !== "bbl") {
                    c.path = (entry.kind === 'directory') ? path + "/" : path;
                }
            }
            if (entry.kind === 'directory') {
                // Recurse into any directories we find
                await this._list(entry, comics);
            }
        }
    }

    async getImageUrl(c: Comic): Promise<string> {
        const imgFile = await resolveFile(this.dir, c.path).then(hdl => hdl.getFile());
        const url = URL.createObjectURL(imgFile);
        return url;
    }

    async getBubbles(c: Comic, language?: string): Promise<Bubble[]> {
        const lang = language ? language : c.languages[0];
        const bblPath = baseNameExt(c.path)[0] + (lang !== "" ? "." + lang : "") + ".bbl";
        const jsonText = await resolveFile(this.dir, bblPath).then(hdl => hdl.getFile()).then(file => file.text());
        const json = JSON.parse(jsonText);
        console.log("BBL", json);
        return json.pages[0].bubbles;
    }
}

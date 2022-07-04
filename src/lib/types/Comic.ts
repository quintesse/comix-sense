import type { ComicStore } from "./ComicStore";
import type { StrStrMap } from "./funcs";

export class Comic {
    path: string;
    languages: string[];
    private store: ComicStore;

    private langBubbles: { [key: string]: Bubble[] } = {};

    constructor(path: string, languages: string[], store: ComicStore) {
        this.path = path;
        this.languages = languages;
        this.store = store;
    }

    getImageUrl(): Promise<string> {
        return this.store.getImageUrl(this);
    }

    getBubbles(language?: string): Promise<Bubble[]> {
        const lang = language ? language : this.languages[0];
        if  (lang in this.langBubbles) {
            return Promise.resolve(this.langBubbles[lang]);
        } else {
            return this.store.getBubbles(this, lang).then(x => this.langBubbles[lang] = x);
        }
    }
};
export type Bubble = {
    text: string;
    lang?: string;
    style?: StrStrMap;
    shape: BblShape;
}

export type BblShape = {
    type: string;
    vs: Vertex[];
}

export type Vertex = {
    x: number;
    y: number;
};

export type Bounds = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    w: number;
    h: number;
};

export function bounds(vs: Vertex[]): Bounds {
    var minX = Number.MAX_SAFE_INTEGER;
    var maxX = Number.MIN_SAFE_INTEGER;
    var minY = Number.MAX_SAFE_INTEGER;
    var maxY = Number.MIN_SAFE_INTEGER;
    for (let v of vs) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
    }
    return { x1: minX, y1: minY, x2: maxX, y2: maxY, w: maxX - minX, h: maxY - minY };
}

export abstract class Shape {
    abstract readonly type: string;
    abstract vertices(): Vertex[];
    abstract boundingBox(): Box;
    abstract poly(): Poly;

    static create(shape: BblShape): Shape {
        if (shape.type === "box") {
            return new Box(shape);
        } else if (shape.type === "poly") {
            return new Poly(shape);
        } else {
            throw "Unexpected Shape type: " + shape.type
        }
    }
}

export class Box implements Shape {
    private shape: BblShape;

    readonly type: string = "box";

    constructor(shape: BblShape) {
        this.shape = shape;
    }

    vertices(): Vertex[] {
        return this.shape.vs;
    }

    boundingBox(): Box {
        throw new Error("Method not implemented.");
    }

    poly(): Poly {
        throw new Error("Method not implemented.");
    }
}

export class Poly implements Shape {
    private shape: BblShape;

    readonly type: string = "poly";

    constructor(shape: BblShape) {
        this.shape = shape;
    }

    vertices(): Vertex[] {
        return this.shape.vs;
    }

    boundingBox(): Box {
        throw new Error("Method not implemented.");
    }

    poly(): Poly {
        throw new Error("Method not implemented.");
    }
}

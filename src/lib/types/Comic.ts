import type { ComicStore } from "./ComicStore";

export class Comic {
    path: string;
    languages?: string[];
    getImageUrl: () => Promise<string>;
    getBubbles: (language?: string) => Promise<Bubble[]>;

    constructor(path: string, languages: string[], store: ComicStore) {
        this.path = path;
        this.languages = languages;
        this.getImageUrl = () => store.getImageUrl(this);
        this.getBubbles = (language?: string) => store.getBubbles(this, language);
    }
};

export type Bubble = {
    text: string;
    lang: string;
    style: { [key: string]: string};
    shape: Shape;
}

export type Vertex = {
    x: number;
    y: number;
};

interface Shape {
    readonly type: string;
    vertices(): Vertex[];
    boundingBox(): Box;
    poly(): Poly;
}

class Box implements Shape {
    readonly type: string = "box";

    vertices(): Vertex[] {
        throw new Error("Method not implemented.");
    }

    boundingBox(): Box {
        throw new Error("Method not implemented.");
    }

    poly(): Poly {
        throw new Error("Method not implemented.");
    }
}

class Poly implements Shape {
    readonly type: string = "poly";
    
    vertices(): Vertex[] {
        throw new Error("Method not implemented.");
    }

    boundingBox(): Box {
        throw new Error("Method not implemented.");
    }

    poly(): Poly {
        throw new Error("Method not implemented.");
    }
}

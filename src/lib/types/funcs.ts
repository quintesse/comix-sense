
export function baseNameExt(name: string): [string, string] {
    const p = name.lastIndexOf(".");
    if (p > 0) {
        return [name.substring(0, p), name.substring(p + 1)];
    } else {
        return [name, ""];
    }
}

export const supportedImageTypes = [ "bmp", "gif", "jpg", "jpeg", "png", "webp" ];

export async function resolveFile(dir: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
    const parts = path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
    }
    return await dir.getFileHandle(parts[parts.length - 1]);
}

"""Lossless BBL translation batches; run with --help. Python standard library only."""
import argparse
import hashlib
import json
from pathlib import Path
import re


TOKEN = re.compile(r'("(?P<key>text|lang)"\s*:\s*)("(?:\\.|[^"\\])*")')


def read(path):
    return json.loads(path.read_bytes().decode("utf-8-sig"))


def text_fields(obj, path=()):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "text":
                yield path + (key,), value
            else:
                yield from text_fields(value, path + (key,))
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            yield from text_fields(value, path + (index,))


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_language(obj, language):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "lang":
                assert value == language, (key, value, language)
            else:
                check_language(value, language)
    elif isinstance(obj, list):
        for value in obj:
            check_language(value, language)


def compare(source, target, language, path=()):
    assert type(source) is type(target), (path, "type")
    if isinstance(source, dict):
        assert list(source) == list(target), (path, "keys/order")
        for key in source:
            if key == "text":
                assert isinstance(target[key], str), (path, "text type")
            elif key == "lang":
                assert target[key] == language, (path, "language")
            else:
                compare(source[key], target[key], language, path + (key,))
    elif isinstance(source, list):
        assert len(source) == len(target), (path, "length")
        for index, (left, right) in enumerate(zip(source, target)):
            compare(left, right, language, path + (index,))
    else:
        assert source == target, (path, "value")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "extract", "insert", "validate"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--source", required=True, help="Verified source language code")
    parser.add_argument("--target", required=True)
    parser.add_argument("--state", type=Path, required=True, help="Persistent JSON manifest")
    parser.add_argument("--reference", help="Optional reviewed translation, for context only")
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--batch", type=Path, help="JSON object: source filename -> ordered text array")
    args = parser.parse_args()
    root = args.directory.resolve()
    assert args.source != args.target
    files = sorted(root.glob(f"*.{args.source}.bbl"))
    assert files, "No source files"

    def target(source):
        return source.with_name(source.name.removesuffix(f".{args.source}.bbl") + f".{args.target}.bbl")

    def save():
        args.state.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.action == "init":
        assert not args.state.exists(), "Manifest exists; use it instead of replacing its baseline"
        state = {"directory": str(root), "source": args.source, "target": args.target,
                 "originals": {p.name: hash_file(p) for p in root.iterdir() if p.is_file()},
                 "missing": [p.name for p in files if not target(p).exists()], "translations": {}}
        save()
        print(f"Snapshot saved; {len(state['missing'])} translations missing")
        return
    state = read(args.state)
    assert (state["directory"], state["source"], state["target"]) == (str(root), args.source, args.target)
    if args.action == "extract":
        for name in state["missing"][args.start:args.start + args.count]:
            source = root / name
            print(name)
            reference = None
            if args.reference:
                rp = source.with_name(name.removesuffix(f".{args.source}.bbl") + f".{args.reference}.bbl")
                if rp.exists():
                    reference = dict(text_fields(read(rp)))
            for path, text in text_fields(read(source)):
                item = {"index": list(path[:-1]), "text": text}
                if reference is not None:
                    item["reference"] = reference.get(path)
                print(json.dumps(item, ensure_ascii=False))
    elif args.action == "insert":
        assert args.batch
        batch = read(args.batch)
        prepared = []
        for name, translations in batch.items():
            assert name in state["missing"] and name not in state["translations"], name
            source = root / name
            dest = target(source)
            assert not dest.exists(), dest
            source_bytes = source.read_bytes()
            raw = source_bytes.decode("utf-8-sig")
            fields = list(text_fields(json.loads(raw)))
            assert len(translations) == len(fields), (name, len(translations), len(fields))
            assert all(isinstance(t, str) for t in translations), name
            values = iter(translations)

            def replace(match):
                value = next(values) if match["key"] == "text" else args.target
                return match[1] + json.dumps(value, ensure_ascii=False)

            result = TOKEN.sub(replace, raw)
            compare(json.loads(raw), json.loads(result), args.target)
            if source_bytes.startswith(b"\xef\xbb\xbf"):
                result = "\ufeff" + result
            prepared.append((name, dest, result, translations))
        for name, dest, result, translations in prepared:
            with dest.open("x", encoding="utf-8", newline="") as stream:
                stream.write(result)
            state["translations"][name] = translations
            save()
        print(f"Created {len(prepared)} files")
    elif args.action == "validate":
        for name, digest in state["originals"].items():
            assert hash_file(root / name) == digest, (name, "original changed")
        assert set(state["translations"]) == set(state["missing"]), "Unfinished batches"
        count = 0
        for source in files:
            dest = target(source)
            assert dest.exists(), dest
            obj = read(dest)
            assert obj["lang"] == args.target, dest
            check_language(obj, args.target)
            if source.name not in state["translations"]:
                continue  # Existing translations may have independently edited geometry.
            compare(read(source), obj, args.target)
            translations = [t for _, t in text_fields(obj)]
            assert translations == state["translations"][source.name], (dest, "translation coverage")
            mask = lambda p: TOKEN.sub(lambda m: m[1] + '"__VALUE__"', p.read_bytes().decode("utf-8-sig"))
            assert mask(source) == mask(dest), (dest, "non-text/lang bytes")
            count += len(translations)
        print(f"PASS: {len(files)} pairs; {len(state['translations'])} created; {count} text fields; "
              f"all other data/bytes identical; {len(state['originals'])} original hashes unchanged")


if __name__ == "__main__":
    main()

///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.google.code.gson:gson:2.13.2
//JAVA 17

import com.google.gson.*;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Usage: jbang tools/bubbletext.java album.en.bbl [LANGUAGE|TRANSLATION.bbl]
 * Prints the cleanup user-message JSON, without the prompt or provider envelope.
 * Page indexes refer to the supplied document, starting at zero.
 */
public class bubbletext {
    private static final Set<String> OVERLAYS = Set.of("ocr");
    private static final Pattern LANGUAGE_SUFFIX = Pattern.compile(
            "([.-])([a-z]{2,3}(?:-[a-z0-9]+)*)\\.bbl$", Pattern.CASE_INSENSITIVE);
    private static final Pattern LANGUAGE_CODE = Pattern.compile(
            "[a-z]{2,3}(?:-[a-z0-9]+)*", Pattern.CASE_INSENSITIVE);

    public static void main(String[] args) {
        if (args.length < 1 || args.length > 2) {
            System.err.println("Usage: jbang tools/bubbletext.java FILE.bbl [LANGUAGE|TRANSLATION.bbl]");
            System.exit(2);
        }
        try {
            var path = Path.of(args[0]);
            var document = read(path);
            var output = args.length == 1 ? extract(document, path.getFileName().toString())
                    : extract(document, path.getFileName().toString(),
                            read(translationPath(path, args[1])),
                            translationPath(path, args[1]).getFileName().toString());
            var writer = new OutputStreamWriter(System.out, StandardCharsets.UTF_8);
            new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(output, writer);
            writer.write('\n');
            writer.flush();
        } catch (Exception error) {
            System.err.println("Bubble text extraction failed: " + error.getMessage());
            System.exit(1);
        }
    }

    private static JsonObject read(Path path) throws java.io.IOException {
        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader).getAsJsonObject();
        }
    }

    static Path translationPath(Path source, String translation) {
        if (!LANGUAGE_CODE.matcher(translation).matches()) return Path.of(translation);
        var filename = source.getFileName().toString();
        var suffix = LANGUAGE_SUFFIX.matcher(filename);
        if (suffix.find()) {
            filename = filename.substring(0, suffix.start()) + suffix.group(1) + translation + ".bbl";
        } else {
            filename = filename.replaceFirst("(?i)\\.bbl$", "") + "." + translation + ".bbl";
        }
        return source.resolveSibling(filename);
    }

    static JsonObject extract(JsonObject document, String filename,
                              JsonObject translation, String translationFilename) {
        var output = extract(document, filename);
        var translated = extract(translation, translationFilename);
        var pages = document.getAsJsonArray("pages");
        var translatedPages = translation.getAsJsonArray("pages");
        if (pages.size() != translatedPages.size())
            throw new IllegalArgumentException("Page count mismatch: source has " + pages.size()
                    + ", translation has " + translatedPages.size());
        for (int i = 0; i < pages.size(); i++) {
            var sourceBubbles = pages.get(i).getAsJsonObject().getAsJsonArray("bubbles");
            var targetBubbles = translatedPages.get(i).getAsJsonObject().getAsJsonArray("bubbles");
            int sourceCount = sourceBubbles == null ? 0 : sourceBubbles.size();
            int targetCount = targetBubbles == null ? 0 : targetBubbles.size();
            if (sourceCount != targetCount)
                throw new IllegalArgumentException("Bubble count mismatch at /pages/" + i
                        + ": source has " + sourceCount + ", translation has " + targetCount);
        }
        output.add("targetLanguage", translated.get("sourceLanguage"));
        var items = output.getAsJsonArray("items");
        var translatedItems = translated.getAsJsonArray("items");
        var changedItems = new JsonArray();
        for (int i = 0; i < items.size(); i++) {
            var item = items.get(i).getAsJsonObject();
            var target = translatedItems.get(i).getAsJsonObject().get("text");
            if (item.get("text").getAsString().equals(target.getAsString())) continue;
            item.add("source", item.remove("text"));
            item.add("target", target);
            changedItems.add(item);
        }
        output.add("items", changedItems);
        return output;
    }

    static JsonObject extract(JsonObject document, String filename) {
        if (!document.has("pages") || !document.get("pages").isJsonArray())
            throw new IllegalArgumentException("Expected a pages array.");
        var items = new JsonArray();
        var locales = new LinkedHashSet<String>();
        var pages = document.getAsJsonArray("pages");
        for (int pageIndex = 0; pageIndex < pages.size(); pageIndex++) {
            var page = pages.get(pageIndex).getAsJsonObject();
            if (!page.has("bubbles")) continue;
            if (!page.get("bubbles").isJsonArray())
                throw new IllegalArgumentException("Expected a bubbles array at /pages/" + pageIndex);
            var bubbles = page.getAsJsonArray("bubbles");
            for (int bubbleIndex = 0; bubbleIndex < bubbles.size(); bubbleIndex++) {
                var bubble = bubbles.get(bubbleIndex).getAsJsonObject();
                var id = "/pages/" + pageIndex + "/bubbles/" + bubbleIndex;
                var text = string(bubble, "text");
                if (text == null) throw new IllegalArgumentException("Expected string text at " + id);
                var item = new JsonObject();
                item.addProperty("id", id);
                item.addProperty("text", text);
                items.add(item);
                var locale = string(bubble, "lang");
                if (locale != null && !locale.isEmpty()
                        && !OVERLAYS.contains(locale.toLowerCase(Locale.ROOT))
                        && !locale.equalsIgnoreCase("und")) locales.add(locale);
            }
        }
        // Like the app, conventional language suffixes identify the selected overlay.
        var suffix = LANGUAGE_SUFFIX.matcher(filename);
        var language = suffix.find() ? suffix.group(2) : string(document, "lang");
        if (language == null || language.isEmpty()
                || OVERLAYS.contains(language.toLowerCase(Locale.ROOT)))
            language = locales.size() == 1 ? locales.iterator().next() : "und";
        var output = new JsonObject();
        output.addProperty("sourceLanguage", language);
        output.addProperty("targetLanguage", language);
        output.add("items", items);
        return output;
    }

    private static String string(JsonObject object, String key) {
        var value = object.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
                ? value.getAsString() : null;
    }
}

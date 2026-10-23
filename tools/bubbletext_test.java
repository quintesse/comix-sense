///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.google.code.gson:gson:2.13.2
//SOURCES bubbletext.java
//JAVA 17

import com.google.gson.*;
import java.nio.file.Path;

/** Run from repository root: jbang tools/bubbletext_test.java */
public class bubbletext_test {
    public static void main(String[] args) {
        var source = doc("nl", new String[]{"Hallo\nwereld!", ""}, new String[]{"Dag"});
        var target = doc("en", new String[]{"Hello\nworld!", ""}, new String[]{"Bye"});
        var originalSource = source.deepCopy();
        var originalTarget = target.deepCopy();
        var single = bubbletext.extract(source, "album-mrg.bbl");
        check(single.get("sourceLanguage").getAsString().equals("nl"), "overlay language metadata");
        check(single.get("targetLanguage").equals(single.get("sourceLanguage")), "single-file language");
        check(single.getAsJsonArray("items").get(0).getAsJsonObject().has("text"), "single-file text retained");
        var paired = bubbletext.extract(source, "album-mrg.bbl", target, "album-en.bbl");
        check(paired.get("targetLanguage").getAsString().equals("en"), "target language");
        var items = paired.getAsJsonArray("items");
        check(items.size() == 2, "identical empty texts excluded");
        var first = items.get(0).getAsJsonObject();
        check(first.size() == 3 && !first.has("text"), "paired schema");
        check(first.get("source").getAsString().equals("Hallo\nwereld!")
                && first.get("target").getAsString().equals("Hello\nworld!"), "paired texts and newlines");
        check(items.get(1).getAsJsonObject().get("id").getAsString().equals("/pages/1/bubbles/0"), "original page indexes after filtering");
        check(bubbletext.extract(source, "album.nl.bbl", source, "album.en.bbl")
                .getAsJsonArray("items").isEmpty(), "all identical texts excluded");
        var differences = bubbletext.extract(
                doc("nl", new String[]{"Same", "Hello", "word", "line\n", ""}), "album.nl.bbl",
                doc("en", new String[]{"Same", "hello", "word ", "line", "added"}), "album.en.bbl")
                .getAsJsonArray("items");
        check(differences.size() == 4, "only exact matches excluded; case, spaces, newlines and empty differences retained");
        check(differences.get(0).getAsJsonObject().get("id").getAsString().equals("/pages/0/bubbles/1"),
                "original bubble indexes after filtering");
        check(source.equals(originalSource) && target.equals(originalTarget), "inputs unchanged");
        check(bubbletext.extract(source, "album.nl.bbl", target, "album.fr.bbl")
                .get("targetLanguage").getAsString().equals("fr"), "target suffix precedence");
        check(bubbletext.extract(source, "album", target, "translation.bbl")
                .get("targetLanguage").getAsString().equals("en"), "target metadata fallback");
        path("dir/SW-A070-P09-mrg.bbl", "en", "dir/SW-A070-P09-en.bbl");
        path("dir/album.nl.bbl", "pt-BR", "dir/album.pt-BR.bbl");
        path("dir/album-pt-BR.bbl", "en", "dir/album-en.bbl");
        path("dir/album.bbl", "en", "dir/album.en.bbl");
        path("dir/album.bbl", "elsewhere/translated.bbl", "elsewhere/translated.bbl");
        reject(source, doc("en", new String[]{"Hello", ""}), "Page count mismatch");
        reject(source, doc("en", new String[]{"Hello"}, new String[]{"", "Bye"}), "Bubble count mismatch at /pages/0");
        var invalid = target.deepCopy();
        invalid.getAsJsonArray("pages").get(0).getAsJsonObject().getAsJsonArray("bubbles")
                .get(0).getAsJsonObject().addProperty("text", 123);
        reject(source, invalid, "Expected string text");
        var empty = JsonParser.parseString("{\"pages\":[{}]}").getAsJsonObject();
        check(bubbletext.extract(empty, "album.nl.bbl", doc("en", new String[]{}), "album.en.bbl")
                .getAsJsonArray("items").isEmpty(), "missing bubbles treated as empty page");
        System.out.println("bubbletext tests passed");
    }

    static JsonObject doc(String lang, String[]... texts) {
        var document = new JsonObject();
        document.addProperty("lang", lang);
        var pages = new JsonArray();
        document.add("pages", pages);
        for (var pageTexts : texts) {
            var page = new JsonObject();
            var bubbles = new JsonArray();
            page.add("bubbles", bubbles);
            pages.add(page);
            for (var text : pageTexts) {
                var bubble = new JsonObject();
                bubble.addProperty("text", text);
                bubble.addProperty("lang", lang);
                bubbles.add(bubble);
            }
        }
        return document;
    }

    static void path(String source, String argument, String expected) {
        check(bubbletext.translationPath(Path.of(source), argument).equals(Path.of(expected)), "path: " + argument);
    }

    static void reject(JsonObject source, JsonObject target, String message) {
        try {
            bubbletext.extract(source, "album.nl.bbl", target, "album.en.bbl");
        } catch (IllegalArgumentException error) {
            check(error.getMessage().contains(message), error.getMessage());
            return;
        }
        throw new AssertionError("Expected rejection: " + message);
    }

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}

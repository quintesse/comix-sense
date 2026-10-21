///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.google.code.gson:gson:2.13.2
//JAVA 17

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * Usage: jbang tools/ocr2bbl.java < page-ocr.json > page.bbl
 * Converts the AnnotateImageResponse printed by tools/ocr.java to one BBL page.
 * Each word uses an axis-aligned box enclosing all its OCR polygon vertices.
 * Skips the full-page annotation; word locales fall back to its locale, then und.
 */
public class ocr2bbl {
    public static void main(String[] args) {
        if (args.length != 0) {
            System.err.println("Usage: jbang tools/ocr2bbl.java < page-ocr.json > page.bbl");
            System.exit(2);
        }

        try {
            var input = JsonParser.parseReader(
                    new InputStreamReader(System.in, StandardCharsets.UTF_8)).getAsJsonObject();
            if (input.has("error")) {
                throw new IllegalArgumentException("OCR response contains an error: " + input.get("error"));
            }
            var annotations = input.has("textAnnotations")
                    ? input.getAsJsonArray("textAnnotations") : new JsonArray();
            var language = annotations.isEmpty() ? "und"
                    : locale(annotations.get(0).getAsJsonObject(), "und");
            var bubbles = new JsonArray();
            for (int i = 1; i < annotations.size(); i++) {
                var annotation = annotations.get(i).getAsJsonObject();
                var polygon = annotation.getAsJsonObject("boundingPoly").getAsJsonArray("vertices");
                if (polygon.isEmpty()) {
                    throw new IllegalArgumentException("Word annotation " + i + " has no vertices");
                }
                int minX = Integer.MAX_VALUE;
                int minY = Integer.MAX_VALUE;
                int maxX = Integer.MIN_VALUE;
                int maxY = Integer.MIN_VALUE;
                for (var element : polygon) {
                    var vertex = element.getAsJsonObject();
                    // Protobuf JSON omits coordinates whose value is zero.
                    int x = vertex.has("x") ? vertex.get("x").getAsInt() : 0;
                    int y = vertex.has("y") ? vertex.get("y").getAsInt() : 0;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
                var vertices = new JsonArray();
                vertices.add(vertex(minX, minY));
                vertices.add(vertex(maxX, maxY));
                var shape = new JsonObject();
                shape.addProperty("type", "box");
                shape.add("vs", vertices);
                var bubble = new JsonObject();
                bubble.addProperty("text", annotation.get("description").getAsString());
                bubble.addProperty("lang", locale(annotation, language));
                bubble.add("shape", shape);
                bubbles.add(bubble);
            }

            var page = new JsonObject();
            page.add("bubbles", bubbles);
            var pages = new JsonArray();
            pages.add(page);
            var output = new JsonObject();
            output.addProperty("lang", language);
            output.add("pages", pages);
            var writer = new OutputStreamWriter(System.out, StandardCharsets.UTF_8);
            new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(output, writer);
            writer.write('\n');
            writer.flush();
            System.err.println("OCR to BBL: wrote " + bubbles.size() + " bubbles.");
        } catch (Exception e) {
            System.err.println("OCR to BBL conversion failed: " + e.getMessage());
            System.exit(1);
        }
    }

    private static JsonObject vertex(int x, int y) {
        var vertex = new JsonObject();
        vertex.addProperty("x", x);
        vertex.addProperty("y", y);
        return vertex;
    }

    private static String locale(JsonObject annotation, String fallback) {
        return annotation.has("locale") && !annotation.get("locale").getAsString().isBlank()
                ? annotation.get("locale").getAsString() : fallback;
    }
}

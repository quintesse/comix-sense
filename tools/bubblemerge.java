///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.google.code.gson:gson:2.13.2
//JAVA 17

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.io.*;
import java.util.*;
import java.awt.geom.Area;
import java.awt.geom.PathIterator;
import java.awt.geom.Rectangle2D;

/** Geometry-only, left-to-right OCR word grouping. See bubblemerge.md. */
public class bubblemerge {
    static final Gson JSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().serializeNulls().create();
    record Box(double l, double t, double r, double b) {
        double h() { return b - t; }
        double cx() { return (l + r) / 2; }
        double cy() { return (t + b) / 2; }
        Box union(Box o) { return new Box(Math.min(l,o.l), Math.min(t,o.t), Math.max(r,o.r), Math.max(b,o.b)); }
    }
    record Word(int index, JsonObject json, Box box, String text) {}
    static class Line {
        List<Word> words = new ArrayList<>();
        Box box() { return words.stream().map(Word::box).reduce(Box::union).orElseThrow(); }
        double height() { return median(words.stream().map(w -> w.box.h()).toList()); }
        double center() { return median(words.stream().map(w -> w.box.cy()).toList()); }
        Line(List<Word> words) { this.words.addAll(words); }
    }
    record Edge(int a, int b, double cost) {}

    public static void main(String[] args) throws Exception {
        Path input = null, output = null, reportPath = null;
        for (String arg : args) {
            if (arg.equals("--help")) {
                System.out.println("Usage: jbang tools/bubblemerge.java [--output=FILE] [--report=FILE] [input.bbl]\n"
                        + "Reads UTF-8 BBL from file or stdin. Writes to stdout unless --output is given.\n"
                        + "Output/report files must not already exist. Input must contain OCR words.");
                return;
            } else if (arg.startsWith("--output=")) output = Path.of(arg.substring(9));
            else if (arg.startsWith("--report=")) reportPath = Path.of(arg.substring(9));
            else if (arg.startsWith("--") || input != null) throw new IllegalArgumentException("Unexpected argument: " + arg);
            else input = Path.of(arg);
        }
        if (output != null && reportPath != null && output.toAbsolutePath().normalize().equals(reportPath.toAbsolutePath().normalize()))
            throw new IllegalArgumentException("Output and report paths must differ.");
        JsonObject document;
        try (Reader reader = input == null ? new InputStreamReader(System.in, StandardCharsets.UTF_8)
                : Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
            document = JsonParser.parseReader(reader).getAsJsonObject();
        }
        JsonObject report = merge(document);
        if (output == null) {
            var writer = new OutputStreamWriter(System.out, StandardCharsets.UTF_8);
            JSON.toJson(document, writer); writer.write('\n'); writer.flush();
        } else Files.writeString(output, JSON.toJson(document) + "\n", StandardCharsets.UTF_8, StandardOpenOption.TRUNCATE_EXISTING);
        if (reportPath != null) Files.writeString(reportPath, JSON.toJson(report) + "\n", StandardCharsets.UTF_8, StandardOpenOption.TRUNCATE_EXISTING);
        System.err.println("Bubble merge: " + report.get("inputWords") + " words -> " + report.get("outputBubbles") + " groups.");
    }

    static JsonObject merge(JsonObject document) {
        return merge(document, System.err);
    }

    static JsonObject merge(JsonObject document, PrintStream diagnostics) {
        var report = new JsonObject();
        var pageReports = new JsonArray();
        List<Double> wordHeights = new ArrayList<>(), lineAdvances = new ArrayList<>();
        int count = 0, total = 0;
        for (var pageElement : document.getAsJsonArray("pages")) {
            var page = pageElement.getAsJsonObject();
            var original = page.getAsJsonArray("bubbles");
            List<Word> words = new ArrayList<>();
            for (int i = 0; i < original.size(); i++) {
                var obj = original.get(i).getAsJsonObject();
                words.add(new Word(i, obj, bounds(obj), obj.has("text") ? obj.get("text").getAsString() : ""));
            }
            for (Word word : words) if (word.box.h() > 0) wordHeights.add(word.box.h());
            count += words.size();
            var rows = rows(words);
            List<Line> lines = new ArrayList<>();
            for (Line row : rows) lines.addAll(runs(row));
            var decisions = new JsonArray();
            // Use only original runs as evidence; inferred splits must not reinforce themselves.
            List<Line> splitLines = new ArrayList<>();
            for (Line line : lines) splitLines.addAll(split(line, lines, decisions));
            lines = splitLines;
            lines.sort(Comparator.comparingDouble((Line l) -> l.box().t).thenComparingDouble(l -> l.box().l));
            int n = lines.size();
            int[] parent = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
            // Mutual best continuations prevent one line bridging two columns.
            int[] below = new int[n], above = new int[n];
            Arrays.fill(below, -1); Arrays.fill(above, -1);
            double[] downCost = new double[n], upCost = new double[n];
            Arrays.fill(downCost, Double.POSITIVE_INFINITY); Arrays.fill(upCost, Double.POSITIVE_INFINITY);
            List<Edge> edges = new ArrayList<>();
            for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) {
                double cost = continuation(lines.get(i), lines.get(j));
                if (!Double.isFinite(cost)) continue;
                edges.add(new Edge(i,j,cost));
                if (cost < downCost[i]) { downCost[i] = cost; below[i] = j; }
                if (cost < upCost[j]) { upCost[j] = cost; above[j] = i; }
            }
            for (Edge edge : edges) if (below[edge.a] == edge.b && above[edge.b] == edge.a)
                parent[root(parent, edge.b)] = root(parent, edge.a);
            // A continuous line can support two fragments of the next row (text
            // wrapping around artwork). Only permit this when both are contained
            // in it and both independently choose it as their best predecessor.
            for (int j = 0; j < n; j++) {
                int i = above[j];
                if (i < 0 || below[i] < 0 || below[i] == j) continue;
                Line upper = lines.get(i), lower = lines.get(j), sibling = lines.get(below[i]);
                Box a = upper.box(), b = lower.box(), c = sibling.box();
                double h = upper.height();
                if (above[below[i]] == i && Math.abs(lower.center()-sibling.center()) <= .4*h
                        && b.l >= a.l-.5*h && b.r <= a.r+.5*h
                        && c.l >= a.l-.5*h && c.r <= a.r+.5*h)
                    parent[root(parent,j)] = root(parent,i);
            }
            Map<Integer, List<Line>> groups = new LinkedHashMap<>();
            for (int i = 0; i < n; i++) groups.computeIfAbsent(root(parent,i), k -> new ArrayList<>()).add(lines.get(i));
            var result = new JsonArray();
            var groupReports = new JsonArray();
            var orderedGroups = new ArrayList<>(groups.values());
            // Compare row bands, rather than letting a few pixels of skew put
            // the rightmost balloon before all of its neighbours.
            List<List<Line>> ordered = new ArrayList<>();
            while (!orderedGroups.isEmpty()) {
                double top = orderedGroups.stream().mapToDouble(g -> g.get(0).box().t).min().orElseThrow();
                double h = median(orderedGroups.stream().map(g -> g.get(0).height()).toList());
                var band = orderedGroups.stream().filter(g -> g.get(0).box().t <= top + .5*h)
                        .sorted(Comparator.comparingDouble(g -> g.stream().mapToDouble(l -> l.box().l).min().orElseThrow())).toList();
                ordered.addAll(band); orderedGroups.removeAll(band);
            }
            for (var group : ordered) {
                List<Word> members = group.stream().flatMap(l -> l.words.stream()).toList();
                var first = members.stream().min(Comparator.comparingInt(Word::index)).orElseThrow();
                var merged = first.json.deepCopy();
                var textRows = rows(members);
                textRows.sort(Comparator.comparingDouble(Line::center));
                for (int i = 1; i < textRows.size(); i++) {
                    double advance = textRows.get(i).center() - textRows.get(i-1).center();
                    if (advance > 0) lineAdvances.add(advance);
                }
                if (members.size() > 1) {
                    for (Line row : textRows) row.words.sort(Comparator.comparingDouble(w -> w.box.l));
                    merged.addProperty("text", String.join("\n", textRows.stream().map(bubblemerge::text).toList()));
                    merged.add("shape", outline(group));
                }
                result.add(merged);
                var info = new JsonObject();
                var indices = new JsonArray();
                for (Word w : members) indices.add(w.index);
                info.add("sourceIndices", indices);
                info.addProperty("text", merged.has("text") ? merged.get("text").getAsString() : "");
                groupReports.add(info);
            }
            page.add("bubbles", result);
            total += result.size();
            var pr = new JsonObject(); pr.add("groups", groupReports); pr.add("inferredSplits", decisions); pageReports.add(pr);
        }
        report.addProperty("inputWords", count); report.addProperty("outputBubbles", total); report.add("pages", pageReports);
        diagnostics.println("Median original word height: " + (wordHeights.isEmpty() ? "n/a" : median(wordHeights) + " px"));
        diagnostics.println("Median line advance: " + (lineAdvances.isEmpty() ? "n/a" : median(lineAdvances) + " px"));
        return report;
    }

    static List<Line> rows(List<Word> input) {
        var sorted = new ArrayList<>(input);
        sorted.sort(Comparator.comparing((Word w) -> punctuation(w.text))
                .thenComparingDouble(w -> w.box.cy()).thenComparingDouble(w -> w.box.l).thenComparingInt(Word::index));
        List<Line> rows = new ArrayList<>();
        for (Word word : sorted) {
            Line best = null; double distance = Double.POSITIVE_INFINITY;
            for (Line row : rows) {
                double h = Math.max(word.box.h(), row.height());
                double d = Math.abs(word.box.cy() - row.center());
                boolean smallPunctuation = punctuation(word.text) && word.box.h() <= row.height()
                        && row.words.stream().anyMatch(w -> !punctuation(w.text)
                        && Math.min(w.box.b,word.box.b) >= Math.max(w.box.t,word.box.t)
                        && Math.max(w.box.l,word.box.l)-Math.min(w.box.r,word.box.r) <= .35*w.box.h());
                if (compatible(word, row.words.get(0)) && (smallPunctuation
                        || Math.min(word.box.h(), row.height()) >= .55*h && d <= .42*h)
                        && d < distance) { best = row; distance = d; }
            }
            if (best == null) rows.add(new Line(List.of(word))); else best.words.add(word);
        }
        return rows;
    }

    static List<Line> runs(Line row) {
        row.words.sort(Comparator.comparingDouble((Word w) -> w.box.l).thenComparingInt(Word::index));
        List<Line> result = new ArrayList<>();
        Line current = null;
        for (Word word : row.words) {
            if (current == null || word.box.l - current.box().r > .65 * row.height()) {
                current = new Line(List.of()); result.add(current);
            }
            current.words.add(word);
        }
        return result;
    }

    static List<Line> split(Line line, List<Line> all, JsonArray decisions) {
        Set<Integer> cuts = new TreeSet<>();
        double h = line.height();
        for (Line left : all) for (Line right : all) {
            if (left == line || right == line || left == right) continue;
            Box a = left.box(), b = right.box(), box = line.box();
            if (b.l - a.r < .9 * h || b.l - a.r > 3 * h || Math.abs(left.center() - right.center()) > .4 * h
                    || Math.abs(line.center() - left.center()) > 1.65 * h
                    || Math.abs(line.center() - left.center()) < .6 * h
                    || a.cx() <= box.l || b.cx() >= box.r
                    || !compatible(line.words.get(0),left.words.get(0))
                    || !compatible(line.words.get(0),right.words.get(0))) continue;
            double gutter = (a.r + b.l) / 2;
            int best = -1; double score = -Double.MAX_VALUE;
            for (int i = 1; i < line.words.size(); i++) {
                Box prev = line.words.get(i-1).box, next = line.words.get(i).box;
                double x = (prev.r + next.l) / 2, gap = next.l - prev.r;
                if (x < a.r - 1.5 * h || x > b.l + 1.5 * h || x <= a.cx() || x >= b.cx() || gap < -.25 * h) continue;
                double s = gap - .08 * Math.abs(x - gutter);
                if (s > score) { score = s; best = i; }
            }
            if (best > 0 && cuts.add(best)) {
                var decision = new JsonObject();
                decision.addProperty("afterSourceIndex", line.words.get(best-1).index);
                decision.addProperty("beforeSourceIndex", line.words.get(best).index);
                decision.addProperty("reason", "Neighbouring line has separated runs; review inferred balloon boundary.");
                decisions.add(decision);
            }
        }
        List<Line> result = new ArrayList<>(); int start = 0;
        for (int cut : cuts) { result.add(new Line(line.words.subList(start,cut))); start = cut; }
        result.add(new Line(line.words.subList(start,line.words.size())));
        return result;
    }

    static double continuation(Line upper, Line lower) {
        Box a = upper.box(), b = lower.box();
        double h = Math.min(upper.height(), lower.height());
        double overlap = Math.min(a.r,b.r) - Math.max(a.l,b.l);
        double gap = b.t - a.b;
        if (!compatible(upper.words.get(0),lower.words.get(0)) || h <= 0
                || Math.max(upper.height(), lower.height()) > 1.9 * h
                || lower.center() - upper.center() < .65 * h || gap < -.5 * h || gap > .65 * h
                || overlap <= 0) return Double.POSITIVE_INFINITY;
        double alignment = Math.min(Math.abs(a.cx()-b.cx()), Math.min(Math.abs(a.l-b.l),Math.abs(a.r-b.r))) / h;
        if (alignment > 2.0) return Double.POSITIVE_INFINITY;
        return Math.max(0,gap) / h + .2 * alignment;
    }

    static boolean compatible(Word a, Word b) {
        return Objects.equals(a.json.get("lang"),b.json.get("lang")) && Objects.equals(a.json.get("style"),b.json.get("style"));
    }
    static boolean punctuation(String text) {
        return !text.isEmpty() && text.codePoints().noneMatch(Character::isLetterOrDigit);
    }
    static String text(Line line) {
        StringBuilder out = new StringBuilder(); String previous = "";
        for (Word w : line.words) {
            String value = w.text;
            if (value.isEmpty()) continue;
            boolean closing = value.matches("[.,!?;:%…，。！？；：、)\\]}>»”’]+") || value.equals("-");
            boolean opening = previous.matches("[(\\[<{«“‘]+");
            if (out.length() > 0 && !closing && !opening) out.append(' ');
            out.append(value); previous = value;
        }
        return out.toString();
    }
    static double median(List<Double> values) {
        var sorted = new ArrayList<>(values); Collections.sort(sorted);
        int n = sorted.size(); return (sorted.get((n-1)/2) + sorted.get(n/2)) / 2;
    }
    static int root(int[] p, int i) { while (p[i] != i) { p[i] = p[p[i]]; i = p[i]; } return i; }
    static Box bounds(JsonObject obj) {
        var shape = obj.getAsJsonObject("shape"); String type = shape.get("type").getAsString();
        var vertices = shape.getAsJsonArray("vs");
        if (!(type.equals("box") && vertices.size() == 2 || type.equals("poly") && vertices.size() >= 3))
            throw new IllegalArgumentException("Expected box or polygon with valid vertices");
        double l = Double.POSITIVE_INFINITY, t = l, r = -l, b = -l;
        for (var element : vertices) {
            var v = element.getAsJsonObject(); double x = v.get("x").getAsDouble(), y = v.get("y").getAsDouble();
            if (!Double.isFinite(x) || !Double.isFinite(y)) throw new IllegalArgumentException("Non-finite coordinate");
            l = Math.min(l,x); t = Math.min(t,y); r = Math.max(r,x); b = Math.max(b,y);
        }
        return new Box(l,t,r,b);
    }
    static JsonObject shape(Box b) {
        var shape = new JsonObject(); shape.addProperty("type","box"); var vs = new JsonArray();
        for (double[] xy : new double[][]{{b.l,b.t},{b.r,b.b}}) {
            var v = new JsonObject(); v.addProperty("x",xy[0]); v.addProperty("y",xy[1]); vs.add(v);
        }
        shape.add("vs",vs); return shape;
    }

    record Point(double x, double y) {}

    /** Union row fragments, expanding nearly aligned edges rather than averaging them. */
    static JsonObject outline(List<Line> lines) {
        double tolerance = .25 * median(lines.stream().map(Line::height).toList());
        double[][] edges = new double[lines.size()][4];
        for (int i=0;i<lines.size();i++) {
            Box b = lines.get(i).box(); edges[i] = new double[]{b.l,b.t,b.r,b.b};
        }
        for (int axis=0;axis<4;axis++) snapOutward(edges,axis,tolerance);
        // Meet across interline whitespace. Work from a snapshot so extensions
        // cannot cascade into later rows. Internal horizontal gaps remain open.
        double[][] original = Arrays.stream(edges).map(double[]::clone).toArray(double[][]::new);
        for (int i=0;i<edges.length;i++) for (int j=0;j<edges.length;j++) {
            double[] a=original[i], b=original[j];
            if (a[3] < b[1] && b[1]-a[3] <= .65*Math.min(lines.get(i).height(),lines.get(j).height())
                    && Math.min(a[2],b[2]) > Math.max(a[0],b[0])) {
                double middle = (a[3]+b[1])/2;
                edges[i][3] = Math.max(edges[i][3],middle);
                edges[j][1] = Math.min(edges[j][1],middle);
            }
        }
        Area area = new Area();
        for (double[] b : edges) area.add(new Area(new Rectangle2D.Double(b[0],b[1],b[2]-b[0],b[3]-b[1])));
        List<List<Point>> contours = new ArrayList<>(); List<Point> contour = null;
        double[] coords = new double[6];
        for (PathIterator it=area.getPathIterator(null); !it.isDone(); it.next()) {
            int kind=it.currentSegment(coords);
            if (kind==PathIterator.SEG_MOVETO) { contour=new ArrayList<>(); contours.add(contour); }
            if (kind==PathIterator.SEG_MOVETO || kind==PathIterator.SEG_LINETO) contour.add(new Point(coords[0],coords[1]));
        }
        Box enclosing = lines.stream().map(Line::box).reduce(Box::union).orElseThrow();
        if (contours.isEmpty()) return shape(enclosing);
        // BBL supports one simple contour, without holes. Filling interior holes
        // is conservative; never cut a slit through text to encode them.
        contour = contours.stream().max(Comparator.comparingDouble(c -> Math.abs(signedArea(c)))).orElseThrow();
        var path = new java.awt.geom.Path2D.Double();
        path.moveTo(contour.get(0).x,contour.get(0).y);
        for (int i=1;i<contour.size();i++) path.lineTo(contour.get(i).x,contour.get(i).y);
        path.closePath();
        Area remainder = new Area(area); remainder.subtract(new Area(path));
        // Disconnected components cannot be represented by one simple polygon.
        if (!remainder.isEmpty()) return shape(enclosing);
        boolean changed=true;
        while (changed && contour.size()>4) {
            changed=false;
            for (int i=0;i<contour.size();i++) {
                Point a=contour.get((i+contour.size()-1)%contour.size()), b=contour.get(i), c=contour.get((i+1)%contour.size());
                if (a.x==b.x && b.x==c.x || a.y==b.y && b.y==c.y) {
                    contour.remove(i); changed=true; break;
                }
            }
        }
        if (contour.size()==4) {
            var bounds=area.getBounds2D();
            return shape(new Box(bounds.getMinX(),bounds.getMinY(),bounds.getMaxX(),bounds.getMaxY()));
        }
        // Canonical clockwise order, starting at the uppermost, leftmost vertex.
        if (signedArea(contour)<0) Collections.reverse(contour);
        int start=0;
        for (int i=1;i<contour.size();i++) if (contour.get(i).y<contour.get(start).y
                || contour.get(i).y==contour.get(start).y && contour.get(i).x<contour.get(start).x) start=i;
        var result=new JsonObject(); result.addProperty("type","poly"); var vertices=new JsonArray();
        for (int i=0;i<contour.size();i++) {
            Point p=contour.get((start+i)%contour.size()); var v=new JsonObject();
            v.addProperty("x",p.x); v.addProperty("y",p.y); vertices.add(v);
        }
        result.add("vs",vertices); return result;
    }

    static double signedArea(List<Point> points) {
        double sum=0;
        for (int i=0;i<points.size();i++) {
            Point a=points.get(i), b=points.get((i+1)%points.size()); sum+=a.x*b.y-b.x*a.y;
        }
        return sum/2;
    }

    static void snapOutward(double[][] edges,int axis,double tolerance) {
        var order=new ArrayList<Integer>(); for (int i=0;i<edges.length;i++) order.add(i);
        order.sort(Comparator.comparingDouble(i -> edges[i][axis]));
        for (int start=0;start<order.size();) {
            int end=start+1; double low=edges[order.get(start)][axis];
            while (end<order.size() && edges[order.get(end)][axis]-low<=tolerance) end++;
            double target=axis<2 ? low : edges[order.get(end-1)][axis];
            for (int i=start;i<end;i++) edges[order.get(i)][axis]=target;
            start=end;
        }
    }
}

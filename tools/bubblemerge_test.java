///usr/bin/env jbang "$0" "$@" ; exit $?
//DEPS com.google.code.gson:gson:2.13.2
//SOURCES bubblemerge.java
//JAVA 17

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Run from repository root: jbang tools/bubblemerge_test.java */
public class bubblemerge_test {
    public static void main(String[] args) throws Exception {
        var doc = document(word("Hello",0,0,40,20), word(",",41,15,44,20), word("world",48,0,90,20),
                word("!",91,0,95,20), word("Next",20,25,65,45));
        bubblemerge.merge(doc);
        check(bubbles(doc).size()==1 && text(doc,0).equals("Hello, world!\nNext"), "lines and small punctuation");

        doc = document(word("A",0,0,40,20),word("B",42,0,82,20),
                word("a",0,25,28,45),word("b",54,25,82,45));
        bubblemerge.merge(doc);
        check(bubbles(doc).size()==2 && text(doc,0).equals("A\na") && text(doc,1).equals("B\nb"),
                "near-touching balloons split using neighbouring row");

        doc = document(word("upper",0,0,100,20),word("lower",0,40,100,60));
        bubblemerge.merge(doc); check(bubbles(doc).size()==2,"large vertical gap separates balloons");

        doc = document(word("Tall",0,0,100,40),word("short",50,35,100,59),word("?",120,0,140,80));
        bubblemerge.merge(doc);
        check(bubbles(doc).size()==2 && text(doc,0).equals("Tall\nshort"),"overlapping rows and large standalone punctuation");

        doc = document(word("wide",0,0,180,20),word("left",0,25,30,45),word("right",140,25,180,45));
        bubblemerge.merge(doc); check(bubbles(doc).size()==1 && text(doc,0).equals("wide\nleft right"),"irregular row fragments");
        check(!area(bubbles(doc).get(0).getAsJsonObject()).contains(90,35),"open cut-in between row fragments preserved");
        check(bubbles(doc).get(0).getAsJsonObject().getAsJsonObject("shape").get("type").getAsString().equals("poly"),"cut-in uses polygon");

        doc = document(word("one",0,0,100,20),word("two",3,25,97,45));
        bubblemerge.merge(doc);
        check(bubbles(doc).get(0).getAsJsonObject().getAsJsonObject("shape").equals(bubblemerge.shape(new bubblemerge.Box(0,0,100,45))),
                "minor left/right differences expand outward to a box");
        doc = document(word("one",0,0,100,20),word("two",30,25,70,45));
        bubblemerge.merge(doc);
        var stepped=area(bubbles(doc).get(0).getAsJsonObject());
        check(stepped.contains(5,10) && !stepped.contains(5,35) && stepped.contains(50,35),"large step retained");

        var en = word("English",0,0,40,20); en.addProperty("lang","en");
        var nl = word("Dutch",41,0,80,20); nl.addProperty("lang","nl");
        doc = document(en,nl); bubblemerge.merge(doc); check(bubbles(doc).size()==2,"language boundary");
        en.remove("lang"); nl.remove("lang"); en.add("style", JsonParser.parseString("{\"fill\":\"red\"}"));
        doc = document(en,nl); bubblemerge.merge(doc); check(bubbles(doc).size()==2,"style boundary");

        var styled = en.get("style").deepCopy();
        nl.add("style", styled.deepCopy());
        doc = document(en,nl); bubblemerge.merge(doc);
        check(bubbles(doc).size()==1 && bubbles(doc).get(0).getAsJsonObject().get("style").equals(styled), "merged mask style preserved");
        en.add("layout", bubblemerge.shape(new bubblemerge.Box(100,100,150,150)));
        doc = document(en,nl); bubblemerge.merge(doc);
        check(bubbles(doc).size()==2 && bubbles(doc).get(0).getAsJsonObject().get("layout").equals(en.get("layout")), "independent layout not merged");

        var polygon = word("poly",50,50,60,60);
        polygon.getAsJsonObject("shape").addProperty("type","poly");
        polygon.getAsJsonObject("shape").getAsJsonArray("vs").add(JsonParser.parseString("{\"x\":55,\"y\":70}"));
        doc = document(polygon); bubblemerge.merge(doc); check(bubbles(doc).get(0).equals(polygon),"singleton polygon preserved");
        doc = document(word("",0,0,0,0)); bubblemerge.merge(doc); check(bubbles(doc).size()==1,"empty zero-size token preserved");
        doc = document(); bubblemerge.merge(doc); check(bubbles(doc).isEmpty(),"empty page");

        doc = document(word("one",0,0,20,20),word("two",22,0,42,20),word("three",44,0,64,20),
                word("four",0,25,64,45));
        var secondPage = document(word("a",0,0,100,40),word("b",0,50,100,90),word("c",0,110,100,150));
        doc.getAsJsonArray("pages").add(secondPage.getAsJsonArray("pages").get(0));
        String diagnostics = diagnostics(doc);
        check(diagnostics.contains("Median original word height: 20.0 px")
                && diagnostics.contains("Median line advance: 50.0 px"),"file-wide medians pool original words and individual row advances across pages");
        doc = document(word("wide",0,0,180,20),word("left",0,25,30,45),word("right",140,25,180,45));
        check(diagnostics(doc).contains("Median line advance: 25.0 px"),"row fragments do not create extra advances");
        doc = document(word("word",0,0,40,20),word("!",100,100,110,130));
        diagnostics = diagnostics(doc);
        check(diagnostics.contains("Median original word height: 25.0 px")
                && diagnostics.contains("Median line advance: n/a"),"original punctuation included; unrelated groups do not supply line spacing");
        diagnostics = diagnostics(document(word("",0,0,0,0)));
        check(diagnostics.contains("Median original word height: n/a")
                && diagnostics.contains("Median line advance: n/a"),"zero-size entries have no measurements");
        check(diagnostics(document()).contains("Median original word height: n/a"),"empty file diagnostics");

        var source = JsonParser.parseString(Files.readString(Path.of("tools/SW-A070-P09-ocr.bbl"))).getAsJsonObject();
        var inputCopy = source.deepCopy();
        var result = source.deepCopy();
        result.addProperty("custom","retained");
        result.getAsJsonArray("pages").get(0).getAsJsonObject().addProperty("image","example.png");
        result.getAsJsonArray("pages").add(source.getAsJsonArray("pages").get(0).deepCopy());
        var report = bubblemerge.merge(result);
        check(source.equals(inputCopy),"input object untouched when merging copy");
        check(result.get("custom").getAsString().equals("retained"),"document metadata");
        check(result.getAsJsonArray("pages").get(0).getAsJsonObject().get("image").getAsString().equals("example.png"),"page metadata");
        check(bubbles(result).size()==18,"sample: 18 visually reviewed regions");
        check(result.getAsJsonArray("pages").get(1).getAsJsonObject().get("bubbles").equals(bubbles(result)),"page isolation");
        check(text(result,0).startsWith("Verhin!") && text(result,1).startsWith("Lieve help!"),"sample upper balloons");
        check(text(result,11).endsWith("weg!") && text(result,12).startsWith("Sidonia,"),"sample crowded middle balloons");
        Set<Integer> seen = new HashSet<>();
        var groups = report.getAsJsonArray("pages").get(0).getAsJsonObject().getAsJsonArray("groups");
        var expectedGroups = JsonParser.parseString(Files.readString(Path.of("tools/SW-A070-P09-groups.json")))
                .getAsJsonObject().getAsJsonArray("groups");
        for (int i=0;i<groups.size();i++) {
            Set<Integer> expectedMembers = new TreeSet<>(), actualMembers = new TreeSet<>();
            expectedGroups.get(i).getAsJsonArray().forEach(v -> expectedMembers.add(v.getAsInt()));
            groups.get(i).getAsJsonObject().getAsJsonArray("sourceIndices").forEach(v -> actualMembers.add(v.getAsInt()));
            check(actualMembers.equals(expectedMembers),"visually reviewed sample membership, group " + i);
            bubblemerge.Box union = null;
            int earliest = Integer.MAX_VALUE;
            for (var idx : groups.get(i).getAsJsonObject().getAsJsonArray("sourceIndices")) {
                int index = idx.getAsInt(); check(seen.add(index),"no duplicated source words"); earliest = Math.min(earliest,index);
                var box = bubblemerge.bounds(bubbles(source).get(index).getAsJsonObject());
                union = union == null ? box : union.union(box);
            }
            check(bubblemerge.bounds(bubbles(result).get(i).getAsJsonObject()).equals(union),"exact enclosing geometry");
            var outline=area(bubbles(result).get(i).getAsJsonObject());
            for (int index : actualMembers) {
                var outside=area(bubbles(source).get(index).getAsJsonObject()); outside.subtract(outline);
                check(outside.isEmpty(),"entire source word box contained, group " + i + ", word " + index);
            }
            if (i==13) check(!outline.contains(160,1650),"Sidonia head cut-in retained");
            var shape=bubbles(result).get(i).getAsJsonObject().getAsJsonObject("shape");
            if (shape.get("type").getAsString().equals("poly")) {
                var vs=shape.getAsJsonArray("vs");
                for (int k=0;k<vs.size();k++) {
                    var a=vs.get(k).getAsJsonObject(); var b=vs.get((k+1)%vs.size()).getAsJsonObject();
                    var c=vs.get((k+2)%vs.size()).getAsJsonObject();
                    boolean vertical=a.get("x").equals(b.get("x")), horizontal=a.get("y").equals(b.get("y"));
                    check(vertical != horizontal,"nonzero orthogonal polygon edge");
                    check(!(vertical && b.get("x").equals(c.get("x"))) && !(horizontal && b.get("y").equals(c.get("y"))),"no redundant collinear corners");
                }
            }
            var original = bubbles(source).get(earliest).getAsJsonObject().deepCopy();
            var actual = bubbles(result).get(i).getAsJsonObject().deepCopy();
            original.remove("text"); original.remove("shape"); actual.remove("text"); actual.remove("shape");
            check(original.equals(actual),"earliest member metadata");
        }
        check(seen.size()==212,"all source words accounted for");
        for (double scale : new double[]{.25,1,4}) {
            var shuffled = source.deepCopy();
            List<JsonElement> elements = new ArrayList<>(); bubbles(shuffled).forEach(elements::add);
            Collections.shuffle(elements,new Random(73)); var array = new JsonArray();
            for (var element : elements) {
                for (var v : element.getAsJsonObject().getAsJsonObject("shape").getAsJsonArray("vs")) {
                    var point = v.getAsJsonObject();
                    point.addProperty("x",point.get("x").getAsDouble()*scale+17);
                    point.addProperty("y",point.get("y").getAsDouble()*scale+31);
                }
                array.add(element);
            }
            shuffled.getAsJsonArray("pages").get(0).getAsJsonObject().add("bubbles",array);
            bubblemerge.merge(shuffled);
            check(bubbles(shuffled).size()==18,"scale and input-order invariance");
            for (int i=0;i<18;i++) {
                check(text(shuffled,i).equals(text(result,i)),"stable reading order after shuffle/scale");
                var transformed=area(bubbles(shuffled).get(i).getAsJsonObject());
                transformed.transform(new java.awt.geom.AffineTransform(1/scale,0,0,1/scale,-17/scale,-31/scale));
                transformed.exclusiveOr(area(bubbles(result).get(i).getAsJsonObject()));
                check(transformed.isEmpty(),"outline independent of input order and scale");
            }
        }
        System.out.println("All bubblemerge tests passed (synthetic layouts, sample, conservation, scaling, shuffled input).");
    }
    static JsonObject word(String text,double l,double t,double r,double b) {
        var word = new JsonObject(); word.addProperty("text",text);
        word.add("shape",bubblemerge.shape(new bubblemerge.Box(l,t,r,b))); return word;
    }
    static JsonObject document(JsonObject... words) {
        var doc = JsonParser.parseString("{\"pages\":[{\"bubbles\":[]}]}").getAsJsonObject();
        for (var w:words) bubbles(doc).add(w.deepCopy()); return doc;
    }
    static JsonArray bubbles(JsonObject doc) { return doc.getAsJsonArray("pages").get(0).getAsJsonObject().getAsJsonArray("bubbles"); }
    static String text(JsonObject doc,int i) { return bubbles(doc).get(i).getAsJsonObject().get("text").getAsString(); }
    static String diagnostics(JsonObject doc) {
        var output = new java.io.ByteArrayOutputStream();
        try (var stream = new java.io.PrintStream(output, true, java.nio.charset.StandardCharsets.UTF_8)) {
            bubblemerge.merge(doc, stream);
        }
        return output.toString(java.nio.charset.StandardCharsets.UTF_8);
    }
    static java.awt.geom.Area area(JsonObject bubble) {
        var s=bubble.getAsJsonObject("shape");
        if (s.get("type").getAsString().equals("box")) {
            var b=bubblemerge.bounds(bubble);
            return new java.awt.geom.Area(new java.awt.geom.Rectangle2D.Double(b.l(),b.t(),b.r()-b.l(),b.b()-b.t()));
        }
        var p=new java.awt.geom.Path2D.Double(); int i=0;
        for (var v:s.getAsJsonArray("vs")) {
            double x=v.getAsJsonObject().get("x").getAsDouble(), y=v.getAsJsonObject().get("y").getAsDouble();
            if(i++==0) p.moveTo(x,y); else p.lineTo(x,y);
        }
        p.closePath(); return new java.awt.geom.Area(p);
    }
    static void check(boolean ok,String message) { if(!ok) throw new AssertionError(message); }
}

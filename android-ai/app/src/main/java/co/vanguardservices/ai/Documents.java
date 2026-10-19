package co.vanguardservices.ai;

import android.content.Context;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;

import org.json.JSONException;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Turns attached files into text, then fits that text into what the chosen model can read.
 * Mirrors desktop-ai/src/documents.js.
 */
final class Documents {
    static final long MAX_BYTES = 50L * 1024 * 1024;
    private static final Set<String> TEXT_EXT = new HashSet<>(Arrays.asList(
            "txt", "md", "csv", "tsv", "json", "xml", "html", "htm", "log", "yaml", "yml", "rtf"));

    private Documents() {}

    static void init(Context context) {
        PDFBoxResourceLoader.init(context.getApplicationContext());
    }

    /** Returns {name, chars, pages?, text} or throws with a message the user can act on. */
    static JSONObject extract(String name, InputStream in) throws Exception {
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        byte[] data = readAll(in);
        String text;
        Integer pages = null;
        switch (ext) {
            case "pdf": {
                try (PDDocument doc = PDDocument.load(data)) {
                    pages = doc.getNumberOfPages();
                    PDFTextStripper stripper = new PDFTextStripper();
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i <= pages; i++) {
                        stripper.setStartPage(i);
                        stripper.setEndPage(i);
                        sb.append("[Page ").append(i).append("]\n").append(stripper.getText(doc).trim()).append("\n\n");
                    }
                    text = sb.toString();
                }
                break;
            }
            case "docx":
                text = docx(data);
                break;
            case "xlsx":
                text = xlsx(data);
                break;
            default:
                if (!TEXT_EXT.contains(ext)) {
                    throw new IllegalArgumentException("Unsupported file type ." + ext + ". Use PDF, Word (.docx), Excel (.xlsx) or text files.");
                }
                text = new String(data, StandardCharsets.UTF_8);
        }
        text = text.replace("\r\n", "\n").replaceAll("[ \\t]+\\n", "\n").replaceAll("\\n{3,}", "\n\n").trim();
        if (text.isEmpty()) throw new IllegalArgumentException("No readable text found (a scanned PDF needs OCR first).");
        JSONObject out = new JSONObject().put("ok", true).put("name", name).put("chars", text.length()).put("text", text);
        if (pages != null) out.put("pages", pages);
        return out;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        long total = 0;
        for (int n; (n = in.read(buf)) > 0; ) {
            total += n;
            if (total > MAX_BYTES) throw new IOException("File is over 50 MB");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static Map<String, byte[]> unzip(byte[] data) throws IOException {
        Map<String, byte[]> files = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(data))) {
            for (ZipEntry e; (e = zip.getNextEntry()) != null; ) {
                if (!e.isDirectory()) files.put(e.getName(), readAll(zip));
            }
        }
        return files;
    }

    private static XmlPullParser parser(byte[] xml) throws Exception {
        XmlPullParser p = XmlPullParserFactory.newInstance().newPullParser();
        p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
        p.setInput(new ByteArrayInputStream(xml), "UTF-8");
        return p;
    }

    /** Word: paragraph text from word/document.xml, tables as tab-separated rows. */
    static String docx(byte[] data) throws Exception {
        byte[] xml = unzip(data).get("word/document.xml");
        if (xml == null) throw new IllegalArgumentException("Not a Word document");
        XmlPullParser p = parser(xml);
        StringBuilder sb = new StringBuilder();
        boolean inText = false;
        for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
            String tag = p.getName();
            if (ev == XmlPullParser.START_TAG) {
                if ("w:t".equals(tag)) inText = true;
                else if ("w:tab".equals(tag)) sb.append('\t');
                else if ("w:br".equals(tag)) sb.append('\n');
            } else if (ev == XmlPullParser.END_TAG) {
                if ("w:t".equals(tag)) inText = false;
                else if ("w:p".equals(tag)) sb.append('\n');
                else if ("w:tc".equals(tag)) sb.append('\t');
            } else if (ev == XmlPullParser.TEXT && inText) {
                sb.append(p.getText());
            }
        }
        return sb.toString();
    }

    /** Excel: every sheet's rows as tab-separated text, using the cached formula results. */
    static String xlsx(byte[] data) throws Exception {
        Map<String, byte[]> files = unzip(data);
        List<String> shared = new ArrayList<>();
        byte[] ss = files.get("xl/sharedStrings.xml");
        if (ss != null) {
            XmlPullParser p = parser(ss);
            StringBuilder cur = null;
            boolean inT = false;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG && "si".equals(p.getName())) cur = new StringBuilder();
                else if (ev == XmlPullParser.START_TAG && "t".equals(p.getName())) inT = true;
                else if (ev == XmlPullParser.END_TAG && "t".equals(p.getName())) inT = false;
                else if (ev == XmlPullParser.END_TAG && "si".equals(p.getName()) && cur != null) shared.add(cur.toString());
                else if (ev == XmlPullParser.TEXT && inT && cur != null) cur.append(p.getText());
            }
        }
        // Sheet names, in workbook order.
        List<String> names = new ArrayList<>();
        byte[] wb = files.get("xl/workbook.xml");
        if (wb != null) {
            XmlPullParser p = parser(wb);
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                if (ev == XmlPullParser.START_TAG && "sheet".equals(p.getName())) names.add(p.getAttributeValue(null, "name"));
            }
        }
        TreeMap<Integer, byte[]> sheets = new TreeMap<>();
        Pattern sheetFile = Pattern.compile("xl/worksheets/sheet(\\d+)\\.xml");
        for (Map.Entry<String, byte[]> e : files.entrySet()) {
            Matcher m = sheetFile.matcher(e.getKey());
            if (m.matches()) sheets.put(Integer.parseInt(m.group(1)), e.getValue());
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<Integer, byte[]> e : sheets.entrySet()) {
            int idx = e.getKey() - 1;
            String sheetName = idx < names.size() ? names.get(idx) : "Sheet" + e.getKey();
            sb.append("[Sheet: ").append(sheetName).append("]\n");
            XmlPullParser p = parser(e.getValue());
            String type = null;
            boolean inValue = false;
            StringBuilder row = new StringBuilder();
            int col = 0;
            for (int ev = p.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = p.next()) {
                String tag = p.getName();
                if (ev == XmlPullParser.START_TAG) {
                    if ("row".equals(tag)) {
                        row.setLength(0);
                        col = 0;
                    } else if ("c".equals(tag)) {
                        type = p.getAttributeValue(null, "t");
                        int target = column(p.getAttributeValue(null, "r"));
                        while (col < target) {
                            if (col > 0) row.append('\t');
                            col++;
                        }
                        if (col > 0) row.append('\t');
                        col++;
                    } else if ("v".equals(tag) || "t".equals(tag)) {
                        inValue = true;
                    }
                } else if (ev == XmlPullParser.END_TAG) {
                    if ("v".equals(tag) || "t".equals(tag)) inValue = false;
                    else if ("row".equals(tag) && row.toString().trim().length() > 0) sb.append(row).append('\n');
                } else if (ev == XmlPullParser.TEXT && inValue) {
                    String v = p.getText();
                    if ("s".equals(type)) {
                        int i = Integer.parseInt(v.trim());
                        row.append(i < shared.size() ? shared.get(i) : "");
                    } else {
                        row.append(v);
                    }
                }
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    /** "C7" → 2 (zero-based column). */
    private static int column(String ref) {
        if (ref == null) return 0;
        int n = 0;
        for (char ch : ref.toCharArray()) {
            if (ch < 'A' || ch > 'Z') break;
            n = n * 26 + (ch - 'A' + 1);
        }
        return Math.max(0, n - 1);
    }

    // ---- Fitting documents into the model's context ----

    private static final Set<String> STOP = new HashSet<>(Arrays.asList((
            "the a an and or of to in on for with is are was were be by at as it this that from what which who how when where why does do can could should would will i you we they me my our your please about tell give show find list summarize summary document file").split(" ")));
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]{2,}");

    private static List<String> terms(String s) {
        List<String> out = new ArrayList<>();
        Matcher m = WORD.matcher(s.toLowerCase(Locale.ROOT));
        while (m.find()) if (!STOP.contains(m.group())) out.add(m.group());
        return out;
    }

    /** The passages that share the most words with the question, in document order. */
    static String relevantPassages(String text, String question, int budget) {
        Set<String> q = new HashSet<>(terms(question));
        int size = 1500, overlap = 200;
        List<int[]> chunks = new ArrayList<>(); // {index, start, end, score}
        for (int start = 0, i = 0; start < text.length(); start += size - overlap, i++) {
            int end = Math.min(text.length(), start + size);
            int score = i == 0 ? 2 : 0;
            for (String w : terms(text.substring(start, end))) if (q.contains(w)) score++;
            chunks.add(new int[]{i, start, end, score});
            if (end >= text.length()) break;
        }
        List<int[]> byScore = new ArrayList<>(chunks);
        byScore.sort((a, b) -> b[3] - a[3]);
        List<int[]> picked = new ArrayList<>();
        int used = 0;
        for (int[] c : byScore) {
            int len = c[2] - c[1];
            if (used + len > budget) continue;
            picked.add(c);
            used += len;
        }
        picked.sort((a, b) -> a[0] - b[0]);
        List<String> parts = new ArrayList<>();
        for (int[] c : picked) parts.add(text.substring(c[1], c[2]));
        return String.join("\n[…]\n", parts);
    }

    /** Returns {context, trimmed}. */
    static String[] buildContext(List<JSONObject> docs, String question, int budget) throws JSONException {
        if (docs.isEmpty()) return new String[]{"", "false"};
        long total = 0;
        for (JSONObject d : docs) total += d.getString("text").length();
        boolean trimmed = total > budget;
        List<String> parts = new ArrayList<>();
        for (JSONObject d : docs) {
            String text = d.getString("text");
            int share = (int) Math.floor(budget * ((double) text.length() / total));
            String body = trimmed ? relevantPassages(text, question, share) : text;
            parts.add("<document name=\"" + d.optString("name") + "\">\n" + body + "\n</document>");
        }
        return new String[]{String.join("\n\n", parts), String.valueOf(trimmed)};
    }

    static List<JSONObject> list(org.json.JSONArray arr) throws JSONException {
        if (arr == null) return Collections.emptyList();
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) out.add(arr.getJSONObject(i));
        return out;
    }
}

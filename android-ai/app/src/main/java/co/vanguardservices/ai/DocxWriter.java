package co.vanguardservices.ai;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Saves an answer as a Word document: Markdown headings, bullets, numbered lists and bold/italic
 * text become real Word formatting. Mirrors desktop-ai/src/exporter.js.
 */
final class DocxWriter {
    private DocxWriter() {}

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static final Pattern INLINE = Pattern.compile("(\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|`[^`]+`)");

    private static String runs(String line) {
        StringBuilder sb = new StringBuilder();
        Matcher m = INLINE.matcher(line);
        int last = 0;
        while (m.find()) {
            if (m.start() > last) sb.append(run(line.substring(last, m.start()), ""));
            String t = m.group();
            if (t.startsWith("**")) sb.append(run(t.substring(2, t.length() - 2), "<w:b/>"));
            else if (t.startsWith("`")) sb.append(run(t.substring(1, t.length() - 1), "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/>"));
            else sb.append(run(t.substring(1, t.length() - 1), "<w:i/>"));
            last = m.end();
        }
        if (last < line.length()) sb.append(run(line.substring(last), ""));
        return sb.toString();
    }

    private static String run(String text, String props) {
        return "<w:r>" + (props.isEmpty() ? "" : "<w:rPr>" + props + "</w:rPr>") + "<w:t xml:space=\"preserve\">" + esc(text) + "</w:t></w:r>";
    }

    private static String para(String style, String body) {
        return "<w:p>" + (style == null ? "" : "<w:pPr><w:pStyle w:val=\"" + style + "\"/></w:pPr>") + body + "</w:p>";
    }

    static byte[] fromMarkdown(String markdown, String title) throws IOException {
        StringBuilder body = new StringBuilder();
        if (title != null && !title.isEmpty()) body.append(para("Title", runs(title)));
        boolean code = false;
        Pattern heading = Pattern.compile("^(#{1,4})\\s+(.*)$");
        Pattern bullet = Pattern.compile("^\\s*[-*•]\\s+(.*)$");
        Pattern numbered = Pattern.compile("^\\s*(\\d+)[.)]\\s+(.*)$");
        for (String raw : markdown.split("\n")) {
            if (raw.trim().startsWith("```")) {
                code = !code;
                continue;
            }
            if (code) {
                body.append(para(null, run(raw, "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/>")));
                continue;
            }
            String line = raw.replaceAll("\\s+$", "");
            if (line.trim().isEmpty() || line.matches("^\\|?\\s*:?-{3,}.*")) continue;
            Matcher m;
            if ((m = heading.matcher(line)).matches()) body.append(para("Heading" + m.group(1).length(), runs(m.group(2))));
            else if ((m = bullet.matcher(line)).matches()) body.append(para("ListBullet", runs(m.group(1))));
            else if ((m = numbered.matcher(line)).matches()) body.append(para(null, run(m.group(1) + ". ", "") + runs(m.group(2))));
            else if (line.startsWith("|")) {
                String[] cells = line.replaceAll("^\\||\\|$", "").split("\\|");
                StringBuilder row = new StringBuilder();
                for (int i = 0; i < cells.length; i++) row.append(i > 0 ? "   |   " : "").append(cells[i].trim());
                body.append(para(null, runs(row.toString())));
            } else body.append(para(null, runs(line.replaceFirst("^>\\s?", ""))));
        }

        String document = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>"
                + body + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\"/></w:sectPr>"
                + "</w:body></w:document>";
        StringBuilder styles = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
                + "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\"/><w:sz w:val=\"22\"/></w:rPr></w:rPrDefault>"
                + "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\"/></w:pPr></w:pPrDefault></w:docDefaults>"
                + "<w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:rPr><w:b/><w:sz w:val=\"40\"/></w:rPr></w:style>"
                + "<w:style w:type=\"paragraph\" w:styleId=\"ListBullet\"><w:name w:val=\"List Bullet\"/><w:pPr><w:ind w:left=\"360\" w:hanging=\"360\"/></w:pPr></w:style>");
        int[] sizes = {32, 28, 24, 22};
        for (int i = 1; i <= 4; i++) {
            styles.append("<w:style w:type=\"paragraph\" w:styleId=\"Heading").append(i).append("\"><w:name w:val=\"heading ").append(i)
                    .append("\"/><w:pPr><w:keepNext/><w:spacing w:before=\"240\"/><w:outlineLvl w:val=\"").append(i - 1)
                    .append("\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"").append(sizes[i - 1]).append("\"/></w:rPr></w:style>");
        }
        styles.append("</w:styles>");
        // Bullets as a simple "•" prefix keep the file valid without a numbering part.
        document = document.replace("<w:pStyle w:val=\"ListBullet\"/></w:pPr>", "<w:pStyle w:val=\"ListBullet\"/></w:pPr><w:r><w:t xml:space=\"preserve\">•\t</w:t></w:r>");

        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            put(zip, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
                    + "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>"
                    + "</Types>");
            put(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>"
                    + "</Relationships>");
            put(zip, "word/_rels/document.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
                    + "</Relationships>");
            put(zip, "word/document.xml", document);
            put(zip, "word/styles.xml", styles.toString());
        }
        return bytes.toByteArray();
    }

    private static void put(ZipOutputStream zip, String name, String text) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(text.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }
}

// pdfkit's browser build ships without fonts; register the two the weekly report uses.
// @ts-expect-error — browser build has no bundled types
import PDFDocument, { registerStdFonts } from '../../node_modules/pdfkit/js/pdfkit.browser.mjs';
// @ts-expect-error — font data modules have no types
import Helvetica from '../../node_modules/pdfkit/js/standard-fonts/Helvetica.mjs';
// @ts-expect-error — font data modules have no types
import HelveticaBold from '../../node_modules/pdfkit/js/standard-fonts/HelveticaBold.mjs';

registerStdFonts(Helvetica, HelveticaBold);
export default PDFDocument;

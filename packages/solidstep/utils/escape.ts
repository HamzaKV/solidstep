/**
 * Escaping helpers for safely embedding dynamic values into server-rendered
 * HTML and inline `<script>` tags. Without these, loader data, metadata, and
 * asset attributes interpolated into the SSR output are an XSS vector
 * (attribute-injection in HTML, `</script>` breakout inside scripts).
 */

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Escape a value for use as HTML text content or inside a double/single-quoted
 * attribute value. Encodes `& < > " '` so the value cannot break out of its
 * surrounding tag or attribute.
 */
export const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// U+2028/U+2029 are JS line terminators (valid in JSON strings but not in
// pre-ES2019 JS source). Built from char codes so this file stays pure ASCII.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

/**
 * Escape a serialized payload (JSON or a seroval JS expression) for safe
 * embedding **inside** an inline `<script>` element.
 *
 * `<`, `>`, and `&` only ever appear inside string literals in JSON / seroval
 * data expressions, so replacing them with their `\u` escapes keeps the
 * expression semantically identical while preventing `</script>` / `<!--`
 * breakout.
 */
export const escapeScript = (value: string): string =>
    value
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(LINE_SEPARATOR, '\\u2028')
        .replace(PARAGRAPH_SEPARATOR, '\\u2029');

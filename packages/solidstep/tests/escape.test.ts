import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeScript } from '../utils/escape';

describe('escapeHtml', () => {
    it('encodes the five HTML-significant characters', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('prevents attribute breakout', () => {
        // A value that tries to close the quote and inject an event handler.
        const malicious = '" onload="alert(1)';
        const attr = `<meta content="${escapeHtml(malicious)}">`;
        expect(attr).not.toContain('" onload="');
        expect(attr).toContain('&quot; onload=&quot;');
    });

    it('leaves safe text untouched', () => {
        expect(escapeHtml('hello world 123')).toBe('hello world 123');
    });
});

describe('escapeScript', () => {
    it('neutralizes a </script> breakout in a JSON payload', () => {
        const payload = JSON.stringify({
            x: '</script><img src=x onerror=alert(1)>',
        });
        const escaped = escapeScript(payload);
        expect(escaped).not.toContain('</script>');
        expect(escaped).not.toContain('<img');
        expect(escaped).toContain('\\u003c');
    });

    it('escapes <!-- comment-opening sequences', () => {
        expect(escapeScript('<!--')).toBe('\\u003c!--');
    });

    it('escapes &, <, and >', () => {
        expect(escapeScript('a<b>c&d')).toBe('a\\u003cb\\u003ec\\u0026d');
    });

    it('escapes the U+2028 / U+2029 line terminators', () => {
        const input = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
        expect(escapeScript(input)).toBe('a\\u2028b\\u2029c');
    });

    it('round-trips a JSON string (with escaped chars) back to the original value', () => {
        const value = { a: 1, b: 'a<b>c & "d"', nested: { c: [1, 2, 3] } };
        const escaped = escapeScript(JSON.stringify(value));
        expect(escaped).toContain('\\u003c');
        // The \uXXXX sequences are valid escapes inside a JSON string, so the
        // payload still parses back to the original value.
        expect(JSON.parse(escaped)).toEqual(value);
    });
});

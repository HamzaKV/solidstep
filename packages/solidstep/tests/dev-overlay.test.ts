import { describe, it, expect } from 'vitest';
import {
    renderDevOverlayDocument,
    devOverlayClientScript,
} from '../utils/dev-overlay';

describe('renderDevOverlayDocument', () => {
    it('renders an HTML page with the error message, request line, and escaped stack', () => {
        const err = new Error('boom <script>');
        err.stack = 'Error: boom\n  at x (<anonymous>:1:1)';
        const html = renderDevOverlayDocument(err, {
            method: 'GET',
            url: '/oops',
        });
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('Unhandled server error');
        expect(html).toContain('boom &lt;script&gt;'); // message escaped
        expect(html).toContain('GET /oops');
        expect(html).toContain('&lt;anonymous&gt;'); // stack escaped
        expect(html).not.toContain('<script>boom'); // no raw injection
    });

    it('coerces non-Error values and omits the request line when absent', () => {
        const html = renderDevOverlayDocument('plain failure');
        expect(html).toContain('plain failure');
        expect(html).not.toContain('class="ss-req"');
    });
});

describe('devOverlayClientScript', () => {
    it('returns a self-contained inline script that installs the mounter', () => {
        const s = devOverlayClientScript();
        expect(s.startsWith('<script >') || s.startsWith('<script>')).toBe(
            true,
        );
        expect(s).toContain('window.__solidstepDevOverlay');
        expect(s).toContain("addEventListener('error'");
        expect(s).toContain("addEventListener('unhandledrejection'");
    });

    it('stamps the CSP nonce when provided', () => {
        expect(devOverlayClientScript('N0NCE')).toContain('nonce="N0NCE"');
    });
});

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

    it('falls back to defaults for an error with empty name/message/stack', () => {
        const err = new Error('');
        err.name = '';
        err.stack = '';
        const html = renderDevOverlayDocument(err);
        // name falls back to 'Error'; empty message/stack render empty.
        expect(html).toContain('Error — SolidStep (dev)');
        expect(html).toContain('<div class="ss-msg"></div>');
        expect(html).toContain('<pre class="ss-stack"></pre>');
    });

    it('does not throw when an Error subclass reassigns name/message to non-strings', () => {
        // Legal JS: TS's `string` type on Error#name/#message isn't enforced
        // at runtime.
        class WeirdError extends Error {
            constructor() {
                super('boom');
                (this as unknown as { name: unknown }).name = 500;
                (this as unknown as { message: unknown }).message = 404;
            }
        }
        expect(() => renderDevOverlayDocument(new WeirdError())).not.toThrow();
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

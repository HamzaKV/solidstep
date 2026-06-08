import { describe, it, expect } from 'vitest';
import {
    createBasePolicy,
    createStrictPolicy,
    serializePolicy,
    parsePolicy,
    withNonce,
    withHash,
    withCDN,
    withGoogleFonts,
    withWebSockets,
    withDevelopmentSources,
    withProductionSources,
    mergePolicies,
    addDirective,
    removeDirective,
    updateDirective,
    getDirective,
    isDirectivePresent,
    hasSource,
    reportUnsafeDirectives,
    createDirective,
    setSources,
} from '../utils/csp';

describe('createBasePolicy', () => {
    it('includes default-src self', () => {
        const policy = createBasePolicy();
        expect(hasSource(policy, 'default-src', "'self'")).toBe(true);
    });

    it('includes object-src none', () => {
        const policy = createBasePolicy();
        expect(hasSource(policy, 'object-src', "'none'")).toBe(true);
    });

    it('includes script-src directive', () => {
        const policy = createBasePolicy();
        expect(isDirectivePresent(policy, 'script-src')).toBe(true);
    });
});

describe('createStrictPolicy', () => {
    it('has no unsafe sources', () => {
        const policy = createStrictPolicy();
        expect(reportUnsafeDirectives(policy)).toHaveLength(0);
    });

    it('blocks frames', () => {
        const policy = createStrictPolicy();
        expect(hasSource(policy, 'frame-ancestors', "'none'")).toBe(true);
    });
});

describe('serializePolicy / parsePolicy', () => {
    it('serializes a policy to a header string', () => {
        const policy = createStrictPolicy();
        const str = serializePolicy(policy);
        expect(str).toContain("default-src 'self'");
        expect(str).toContain("object-src 'none'");
    });

    it('round-trips through parse and serialize', () => {
        const original = createBasePolicy();
        const serialized = serializePolicy(original);
        const reparsed = parsePolicy(serialized);
        expect(serializePolicy(reparsed)).toBe(serialized);
    });

    it('serializes directives separated by semicolons', () => {
        const policy = [
            createDirective('default-src', ["'self'"]),
            createDirective('object-src', ["'none'"]),
        ];
        const str = serializePolicy(policy);
        expect(str).toBe("default-src 'self'; object-src 'none'");
    });
});

describe('withNonce', () => {
    it('adds nonce to script-src and style-src by default', () => {
        const policy = createBasePolicy();
        const nonce = 'abc123';
        const updated = withNonce(policy, nonce);
        expect(hasSource(updated, 'script-src', `'nonce-${nonce}'`)).toBe(true);
        expect(hasSource(updated, 'style-src', `'nonce-${nonce}'`)).toBe(true);
    });

    it('adds nonce only to specified directives', () => {
        const policy = createBasePolicy();
        const nonce = 'xyz';
        const updated = withNonce(policy, nonce, ['script-src']);
        expect(hasSource(updated, 'script-src', `'nonce-${nonce}'`)).toBe(true);
        expect(hasSource(updated, 'style-src', `'nonce-${nonce}'`)).toBe(false);
    });

    it('does not mutate the original policy', () => {
        const policy = createBasePolicy();
        withNonce(policy, 'nonce123');
        expect(hasSource(policy, 'script-src', "'nonce-nonce123'")).toBe(false);
    });
});

describe('withHash', () => {
    it('adds sha256 hash to script-src by default', () => {
        const policy = createBasePolicy();
        const hash = 'abc123def456';
        const updated = withHash(policy, hash);
        expect(hasSource(updated, 'script-src', `'sha256-${hash}'`)).toBe(true);
    });

    it('supports sha384 and sha512 algorithms', () => {
        const policy = createBasePolicy();
        const updated384 = withHash(policy, 'hashval', 'sha384');
        const updated512 = withHash(policy, 'hashval', 'sha512');
        expect(hasSource(updated384, 'script-src', "'sha384-hashval'")).toBe(
            true,
        );
        expect(hasSource(updated512, 'script-src', "'sha512-hashval'")).toBe(
            true,
        );
    });
});

describe('withCDN', () => {
    it('adds CDN URL to script-src, style-src, img-src, font-src', () => {
        const policy = createBasePolicy();
        const cdn = 'https://cdn.example.com';
        const updated = withCDN(policy, cdn);
        expect(hasSource(updated, 'script-src', cdn)).toBe(true);
        expect(hasSource(updated, 'style-src', cdn)).toBe(true);
        expect(hasSource(updated, 'img-src', cdn)).toBe(true);
        expect(hasSource(updated, 'font-src', cdn)).toBe(true);
    });
});

describe('withWebSockets', () => {
    it('adds ws: to connect-src by default', () => {
        const policy = createBasePolicy();
        const updated = withWebSockets(policy);
        expect(hasSource(updated, 'connect-src', 'ws:')).toBe(true);
    });

    it('adds wss: when secure=true', () => {
        const policy = createBasePolicy();
        const updated = withWebSockets(policy, true);
        expect(hasSource(updated, 'connect-src', 'wss:')).toBe(true);
    });
});

describe('withDevelopmentSources / withProductionSources', () => {
    it('withProductionSources removes unsafe-eval and unsafe-inline from script-src', () => {
        const policy = createBasePolicy();
        const prod = withProductionSources(policy);
        expect(hasSource(prod, 'script-src', "'unsafe-eval'")).toBe(false);
        expect(hasSource(prod, 'script-src', "'unsafe-inline'")).toBe(false);
    });

    it('withDevelopmentSources adds eval and inline to script-src', () => {
        const policy = createStrictPolicy();
        const dev = withDevelopmentSources(policy);
        expect(hasSource(dev, 'script-src', "'unsafe-eval'")).toBe(true);
    });
});

describe('mergePolicies', () => {
    it('merges two policies without duplicating sources', () => {
        const p1 = [createDirective('script-src', ["'self'"])];
        const p2 = [
            createDirective('script-src', [
                "'self'",
                'https://cdn.example.com',
            ]),
        ];
        const merged = mergePolicies(p1, p2);
        const scriptSrc = getDirective(merged, 'script-src')!;
        expect(scriptSrc.sources.filter((s) => s === "'self'")).toHaveLength(1);
        expect(scriptSrc.sources).toContain('https://cdn.example.com');
    });

    it('combines distinct directives from both policies', () => {
        const p1 = [createDirective('default-src', ["'self'"])];
        const p2 = [createDirective('object-src', ["'none'"])];
        const merged = mergePolicies(p1, p2);
        expect(isDirectivePresent(merged, 'default-src')).toBe(true);
        expect(isDirectivePresent(merged, 'object-src')).toBe(true);
    });
});

describe('addDirective / removeDirective / getDirective / updateDirective', () => {
    it('addDirective replaces an existing directive with same name', () => {
        // Two-directive policy so the map visits both matching and non-matching elements
        const policy = [
            createDirective('default-src', ["'self'"]),
            createDirective('object-src', ["'none'"]),
        ];
        const updated = addDirective(
            policy,
            createDirective('default-src', ['https:']),
        );
        expect(getDirective(updated, 'default-src')!.sources).toEqual([
            'https:',
        ]);
        // object-src must be unchanged (the non-matching `: d` branch)
        expect(getDirective(updated, 'object-src')!.sources).toEqual([
            "'none'",
        ]);
    });

    it('addDirective appends a brand-new directive', () => {
        const policy = [createDirective('default-src', ["'self'"])];
        const updated = addDirective(
            policy,
            createDirective('object-src', ["'none'"]),
        );
        expect(isDirectivePresent(updated, 'object-src')).toBe(true);
        expect(updated).toHaveLength(2);
    });

    it('updateDirective returns policy unchanged when directive does not exist', () => {
        const policy = [createDirective('default-src', ["'self'"])];
        const updated = updateDirective(policy, 'script-src', (d) => d);
        expect(updated).toBe(policy);
    });

    it('removeDirective deletes a directive', () => {
        const policy = createBasePolicy();
        const updated = removeDirective(policy, 'object-src');
        expect(isDirectivePresent(updated, 'object-src')).toBe(false);
    });
});

describe('withGoogleFonts', () => {
    it('adds fonts.gstatic.com to font-src', () => {
        const policy = createBasePolicy();
        const updated = withGoogleFonts(policy);
        expect(
            hasSource(updated, 'font-src', 'https://fonts.gstatic.com'),
        ).toBe(true);
    });

    it('adds fonts.googleapis.com to style-src', () => {
        const policy = createBasePolicy();
        const updated = withGoogleFonts(policy);
        expect(
            hasSource(updated, 'style-src', 'https://fonts.googleapis.com'),
        ).toBe(true);
    });
});

describe('hasSource with non-existent directive', () => {
    it('returns false when the directive is not in the policy', () => {
        const policy = [createDirective('default-src', ["'self'"])];
        expect(hasSource(policy, 'script-src', "'self'")).toBe(false);
    });
});

describe('setSources', () => {
    it('replaces all sources on a directive', () => {
        const d = createDirective('script-src', [
            "'self'",
            'https://cdn.example.com',
        ]);
        const updated = setSources(d, ["'none'"]);
        expect(updated.sources).toEqual(["'none'"]);
        expect(updated.name).toBe('script-src');
    });

    it('does not mutate the original directive', () => {
        const d = createDirective('script-src', ["'self'"]);
        setSources(d, ["'none'"]);
        expect(d.sources).toEqual(["'self'"]);
    });
});

describe('reportUnsafeDirectives', () => {
    it('flags directives containing unsafe-inline or unsafe-eval', () => {
        const policy = createBasePolicy();
        const unsafe = reportUnsafeDirectives(policy);
        expect(unsafe).toContain('script-src');
        expect(unsafe).toContain('style-src');
    });

    it('returns empty array for a strict policy', () => {
        expect(reportUnsafeDirectives(createStrictPolicy())).toHaveLength(0);
    });
});

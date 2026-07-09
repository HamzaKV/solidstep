/**
 * Minimal, dependency-free fuzzing helpers: a seeded PRNG (so failures are
 * reproducible from the seed printed in the failure message) plus a pool of
 * adversarial string fragments (control chars, unicode edge cases,
 * prototype-pollution-shaped keys, etc.) combined into random inputs.
 *
 * Not a replacement for a real fuzzing library (no coverage-guided mutation,
 * no shrinking) — just a cheap way to throw hundreds of inputs a human
 * wouldn't think to hand-write at a function and assert an invariant holds
 * for all of them.
 */

/** mulberry32: small, fast, deterministic PRNG. */
const mulberry32 = (seed: number) => {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export type Rng = {
    next: () => number;
    int: (min: number, max: number) => number;
    pick: <T>(arr: readonly T[]) => T;
    bool: () => boolean;
};

export const makeRng = (seed: number): Rng => {
    const next = mulberry32(seed);
    return {
        next,
        int: (min: number, max: number) =>
            min + Math.floor(next() * (max - min + 1)),
        pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
        bool: () => next() < 0.5,
    };
};

// ASCII C0 control chars, relevant whitespace/format chars, and a grab-bag of
// unicode edge cases known to trip up naive string validation.
const CONTROL_AND_FORMAT_CHARS = [
    '\x00',
    '\x01',
    '\x07',
    '\x08',
    '\t',
    '\n',
    '\r',
    '\x1b',
    '\x1f',
    ' ',
    ' ', // non-breaking space
    '​', // zero-width space
    '‎', // left-to-right mark
    '‮', // right-to-left override
    '﻿', // BOM
    '😀', // surrogate pair (emoji)
    '\ud800', // lone high surrogate (invalid on its own)
];

const DANGEROUS_KEYS = [
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    'hasOwnProperty',
    'toString',
    'valueOf',
    'isPrototypeOf',
];

const INJECTION_FRAGMENTS = [
    ';',
    '\r\n',
    '<script>',
    "'; DROP TABLE users; --",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: deliberately a literal SSTI-probe string, not a real template literal
    '${7*7}',
    '{{7*7}}',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.com',
    '\\evil.com',
    'file:///etc/passwd',
];

const SCHEME_HOST_FRAGMENTS = [
    'https://',
    'http://',
    'HTTPS://',
    'https://EXAMPLE.com',
    'https://example.com:8080',
    'https://xn--nxasmq6b.example', // punycode
    'https://user:pass@evil.com',
    'https://good.com@evil.com',
    'https://good.com.evil.com',
    'https://evil.com#good.com',
    'https://evil.com?good.com',
];

const ALL_FRAGMENTS = [
    ...CONTROL_AND_FORMAT_CHARS,
    ...DANGEROUS_KEYS,
    ...INJECTION_FRAGMENTS,
    ...SCHEME_HOST_FRAGMENTS,
    'a',
    '0',
    '/',
    '',
];

/** A random string built from 0-6 concatenated adversarial fragments, occasionally padded very long. */
export const fuzzString = (rng: Rng): string => {
    const partCount = rng.int(0, 6);
    let s = '';
    for (let i = 0; i < partCount; i++) {
        s += rng.pick(ALL_FRAGMENTS);
    }
    // Occasionally stress-test with a very long string.
    if (rng.next() < 0.05) {
        s += rng.pick(['a', ';', '/', '\x00']).repeat(rng.int(1000, 20000));
    }
    return s;
};

/** A random property-key-shaped string, biased toward dangerous prototype-chain names. */
export const fuzzKey = (rng: Rng): string =>
    rng.next() < 0.4 ? rng.pick(DANGEROUS_KEYS) : fuzzString(rng);

/**
 * Run `fn` against `iterations` random inputs from `gen(rng)`. On any thrown
 * assertion, rethrows with the seed and failing input attached so the run is
 * reproducible (`makeRng(printedSeed)` regenerates the same sequence up to
 * that point since each iteration draws a fresh sub-seed).
 */
export const fuzz = <T>(
    seed: number,
    iterations: number,
    gen: (rng: Rng) => T,
    fn: (input: T, i: number) => void,
): void => {
    const rng = makeRng(seed);
    for (let i = 0; i < iterations; i++) {
        const input = gen(rng);
        try {
            fn(input, i);
        } catch (err) {
            const detail =
                typeof input === 'string'
                    ? JSON.stringify(input)
                    : JSON.stringify(input, (_k, v) =>
                          typeof v === 'bigint' ? String(v) : v,
                      );
            throw new Error(
                `fuzz failure at seed=${seed} iteration=${i} input=${detail}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }
};

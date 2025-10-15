/**
 * Content Security Policy Builder
 * Functional, extensible, and type-safe CSP construction
 */

// Core Types
type DirectiveName =
    | 'default-src'
    | 'script-src'
    | 'style-src'
    | 'style-src-elem'
    | 'img-src'
    | 'font-src'
    | 'connect-src'
    | 'media-src'
    | 'object-src'
    | 'frame-src'
    | 'frame-ancestors'
    | 'base-uri'
    | 'form-action'
    | 'worker-src'
    | 'manifest-src';

type Source =
    | "'self'"
    | "'none'"
    | "'unsafe-inline'"
    | "'unsafe-eval'"
    | "'unsafe-hashes'"
    | "'wasm-unsafe-eval'"
    | "'strict-dynamic'"
    | 'data:'
    | 'blob:'
    | 'filesystem:'
    | 'ws:'
    | 'wss:'
    | 'https:'
    | 'http:'
    | string;

type CSPDirective = {
    readonly name: DirectiveName;
    readonly sources: ReadonlyArray<Source>;
};

type CSPPolicy = ReadonlyArray<CSPDirective>;

// Core Builder Functions
const createDirective = (name: DirectiveName, sources: Source[]): CSPDirective => ({
    name,
    sources,
});

const addSource = (directive: CSPDirective, source: Source): CSPDirective => ({
    ...directive,
    sources: [...directive.sources, source],
});

const removeSource = (directive: CSPDirective, source: Source): CSPDirective => ({
    ...directive,
    sources: directive.sources.filter((s) => s !== source),
});

const setSources = (directive: CSPDirective, sources: Source[]): CSPDirective => ({
    ...directive,
    sources,
});

// Policy Manipulation
const addDirective = (policy: CSPPolicy, directive: CSPDirective): CSPPolicy => {
    const existing = policy.find((d) => d.name === directive.name);
    if (existing) {
        return policy.map((d) =>
            d.name === directive.name ? directive : d
        );
    }
    return [...policy, directive];
};

const updateDirective = (
    policy: CSPPolicy,
    name: DirectiveName,
    updater: (directive: CSPDirective) => CSPDirective
): CSPPolicy => {
    const existing = policy.find((d) => d.name === name);
    if (!existing) {
        return policy;
    }
    return policy.map((d) => (d.name === name ? updater(d) : d));
};

const removeDirective = (policy: CSPPolicy, name: DirectiveName): CSPPolicy =>
    policy.filter((d) => d.name !== name);

const getDirective = (policy: CSPPolicy, name: DirectiveName): CSPDirective | undefined =>
    policy.find((d) => d.name === name);

// Merging Policies
const mergeDirectives = (
    directive1: CSPDirective,
    directive2: CSPDirective
): CSPDirective => {
    const uniqueSources = Array.from(
        new Set([...directive1.sources, ...directive2.sources])
    );
    return createDirective(directive1.name, uniqueSources);
};

const mergePolicies = (...policies: CSPPolicy[]): CSPPolicy => {
    const directiveMap = new Map<DirectiveName, CSPDirective>();

    for (const policy of policies) {
        for (const directive of policy) {
            const existing = directiveMap.get(directive.name);
            if (existing) {
                directiveMap.set(directive.name, mergeDirectives(existing, directive));
            } else {
                directiveMap.set(directive.name, directive);
            }
        }
    }

    return Array.from(directiveMap.values());
};

// String Conversion
const serializeDirective = (directive: CSPDirective): string =>
    `${directive.name} ${directive.sources.join(' ')}`;

const serializePolicy = (policy: CSPPolicy): string =>
    policy.map(serializeDirective).join('; ');

const parseDirective = (directiveStr: string): CSPDirective | null => {
    const parts = directiveStr.trim().split(/\s+/);
    if (parts.length < 1) return null;

    const [name, ...sources] = parts;
    return createDirective(name as DirectiveName, sources);
};

const parsePolicy = (policyStr: string): CSPPolicy => {
    const directives = policyStr
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
        .map(parseDirective)
        .filter((d): d is CSPDirective => d !== null);

    return directives;
};

// Preset Builders
const createStrictPolicy = (): CSPPolicy => [
    createDirective('default-src', ["'self'"]),
    createDirective('object-src', ["'none'"]),
    createDirective('base-uri', ["'none'"]),
    createDirective('frame-ancestors', ["'none'"]),
    createDirective('form-action', ["'self'"]),
];

const createBasePolicy = (): CSPPolicy => [
    createDirective('default-src', ["'self'"]),
    createDirective('font-src', ["'self'", 'https://fonts.gstatic.com']),
    createDirective('object-src', ["'none'"]),
    createDirective('base-uri', ["'none'"]),
    createDirective('frame-ancestors', ["'none'"]),
    createDirective('form-action', ["'self'"]),
    createDirective('style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']),
    createDirective('style-src-elem', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']),
    createDirective('script-src', ["'self'", "'unsafe-inline'", "'unsafe-eval'"]),
    createDirective('connect-src', ["'self'", 'ws:']),
    createDirective('img-src', ["'self'", 'data:']),
];

// Environment-Specific Builders
const withDevelopmentSources = (policy: CSPPolicy): CSPPolicy => {
    const devPolicy: CSPPolicy = [
        createDirective('script-src', ["'unsafe-eval'", "'unsafe-inline'"]),
        createDirective('connect-src', ['ws:', 'wss:']),
    ];
    return mergePolicies(policy, devPolicy);
};

const withProductionSources = (policy: CSPPolicy): CSPPolicy =>
    updateDirective(policy, 'script-src', (d) =>
        removeSource(removeSource(d, "'unsafe-eval'"), "'unsafe-inline'")
    );

// Common Integrations
const withCDN = (policy: CSPPolicy, cdnUrl: string): CSPPolicy => {
    const cdnPolicy: CSPPolicy = [
        createDirective('script-src', [cdnUrl]),
        createDirective('style-src', [cdnUrl]),
        createDirective('img-src', [cdnUrl]),
        createDirective('font-src', [cdnUrl]),
    ];
    return mergePolicies(policy, cdnPolicy);
};

const withGoogleFonts = (policy: CSPPolicy): CSPPolicy => {
    const googleFontsPolicy: CSPPolicy = [
        createDirective('font-src', ['https://fonts.gstatic.com']),
        createDirective('style-src', ['https://fonts.googleapis.com']),
    ];
    return mergePolicies(policy, googleFontsPolicy);
};

const withWebSockets = (policy: CSPPolicy, secure = false): CSPPolicy =>
    updateDirective(policy, 'connect-src', (d) =>
        addSource(d, secure ? 'wss:' : 'ws:')
    );

const withNonce = (policy: CSPPolicy, nonce: string, directives: DirectiveName[] = ['script-src', 'style-src']): CSPPolicy => {
    const nonceSource = `'nonce-${nonce}'` as Source;
    let updatedPolicy = policy;

    for (const directive of directives) {
        updatedPolicy = updateDirective(updatedPolicy, directive, (d) =>
            addSource(d, nonceSource)
        );
    }

    return updatedPolicy;
};

const withHash = (policy: CSPPolicy, hash: string, algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256', directive: DirectiveName = 'script-src'): CSPPolicy => {
    const hashSource = `'${algorithm}-${hash}'` as Source;
    return updateDirective(policy, directive, (d) => addSource(d, hashSource));
};

// Utility Functions
const isDirectivePresent = (policy: CSPPolicy, name: DirectiveName): boolean =>
    policy.some((d) => d.name === name);

const hasSource = (policy: CSPPolicy, name: DirectiveName, source: Source): boolean => {
    const directive = getDirective(policy, name);
    return directive ? directive.sources.includes(source) : false;
};

const reportUnsafeDirectives = (policy: CSPPolicy): DirectiveName[] => {
    const unsafeSources: Source[] = ["'unsafe-inline'", "'unsafe-eval'"];
    return policy
        .filter((d) => d.sources.some((s) => unsafeSources.includes(s)))
        .map((d) => d.name);
};

// Export
export {
    // Types
    type DirectiveName,
    type Source,
    type CSPDirective,
    type CSPPolicy,
    // Core
    createDirective,
    addSource,
    removeSource,
    setSources,
    // Policy
    addDirective,
    updateDirective,
    removeDirective,
    getDirective,
    mergePolicies,
    // Serialization
    serializePolicy,
    serializeDirective,
    parsePolicy,
    parseDirective,
    // Presets
    createStrictPolicy,
    createBasePolicy,
    // Environment
    withDevelopmentSources,
    withProductionSources,
    // Integrations
    withCDN,
    withGoogleFonts,
    withWebSockets,
    withNonce,
    withHash,
    // Utils
    isDirectivePresent,
    hasSource,
    reportUnsafeDirectives,
};

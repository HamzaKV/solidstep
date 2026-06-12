/**
 * Helpers for the dynamic metadata-file convention (`app/sitemap.ts`,
 * `app/robots.ts`). Each metadata file exports a default function returning the
 * response body; these helpers build the correct body string for you.
 *
 * `app/manifest.ts` and `app/llms.ts` need no helper — return a plain object
 * (serialized as JSON) or a string respectively.
 */

import { escapeHtml as escapeXml } from './escape';

const toIso = (value: string | Date) =>
    value instanceof Date ? value.toISOString() : value;

/** A single `<url>` entry in a sitemap. */
export type SitemapEntry = {
    /** Absolute URL of the page. */
    url: string;
    /** Last modification time (`Date` is serialized to ISO 8601). */
    lastModified?: string | Date;
    /** How frequently the page is likely to change. */
    changeFrequency?:
        | 'always'
        | 'hourly'
        | 'daily'
        | 'weekly'
        | 'monthly'
        | 'yearly'
        | 'never';
    /** Priority relative to other URLs (0.0–1.0). */
    priority?: number;
};

/**
 * Build a `sitemap.xml` document from a list of entries.
 *
 * @example
 * ```ts
 * // app/sitemap.ts
 * import { sitemap } from 'solidstep/utils/metadata';
 *
 * export default () =>
 *   sitemap([
 *     { url: 'https://example.com/', changeFrequency: 'daily', priority: 1 },
 *     { url: 'https://example.com/about', lastModified: new Date() },
 *   ]);
 * ```
 */
export const sitemap = (entries: SitemapEntry[]): string => {
    const urls = entries
        .map((entry) => {
            const parts = [`<loc>${escapeXml(entry.url)}</loc>`];
            if (entry.lastModified !== undefined) {
                parts.push(
                    `<lastmod>${escapeXml(toIso(entry.lastModified))}</lastmod>`,
                );
            }
            if (entry.changeFrequency !== undefined) {
                parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
            }
            if (entry.priority !== undefined) {
                parts.push(`<priority>${entry.priority}</priority>`);
            }
            return `  <url>${parts.join('')}</url>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
};

/** A `robots.txt` group: one or more user-agents and their rules. */
export type RobotsRule = {
    /** User-agent(s) the rule applies to. Defaults to `*`. */
    userAgent?: string | string[];
    /** Path(s) to allow. */
    allow?: string | string[];
    /** Path(s) to disallow. */
    disallow?: string | string[];
    /** `Crawl-delay` in seconds. */
    crawlDelay?: number;
};

/** Configuration for {@link robots}. */
export type RobotsConfig = {
    /** A single rule group or a list of them. */
    rules: RobotsRule | RobotsRule[];
    /** Sitemap URL(s) to advertise. */
    sitemap?: string | string[];
    /** Preferred `Host`. */
    host?: string;
};

const asArray = <T>(value: T | T[] | undefined): T[] =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Build a `robots.txt` document.
 *
 * @example
 * ```ts
 * // app/robots.ts
 * import { robots } from 'solidstep/utils/metadata';
 *
 * export default () =>
 *   robots({
 *     rules: { userAgent: '*', allow: '/', disallow: '/admin' },
 *     sitemap: 'https://example.com/sitemap.xml',
 *   });
 * ```
 */
export const robots = (config: RobotsConfig): string => {
    const blocks = asArray(config.rules).map((rule) => {
        const lines: string[] = [];
        const agents = asArray(rule.userAgent);
        for (const agent of agents.length ? agents : ['*']) {
            lines.push(`User-agent: ${agent}`);
        }
        for (const allow of asArray(rule.allow)) {
            lines.push(`Allow: ${allow}`);
        }
        for (const disallow of asArray(rule.disallow)) {
            lines.push(`Disallow: ${disallow}`);
        }
        if (rule.crawlDelay !== undefined) {
            lines.push(`Crawl-delay: ${rule.crawlDelay}`);
        }
        return lines.join('\n');
    });

    for (const url of asArray(config.sitemap)) {
        blocks.push(`Sitemap: ${url}`);
    }
    if (config.host !== undefined) {
        blocks.push(`Host: ${config.host}`);
    }

    return blocks.join('\n\n');
};

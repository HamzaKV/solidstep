import { readFile } from 'node:fs/promises';
import { getCacheEntry, setCacheWithOptions } from '../utils/cache';
import { singleFlight } from '../utils/single-flight';
import fetchServer from '../utils/fetch.server';
import { ISR_BYPASS_HEADER } from './constants';
import { logger } from '../utils/logger';

// ISR entries never hard-expire (~10y) so a stale artifact is always served
// while it regenerates in the background.
export const ISR_SWR_MAX = 1000 * 60 * 60 * 24 * 365 * 10;

// Regenerate an ISR page by self-fetching it with the bypass header (so the
// handler renders it fresh), then refresh the cached artifact.
const regenerateIsr = async (
    origin: string,
    pathname: string,
    revalidate: number,
    tags?: string[],
): Promise<string> => {
    const res = await fetchServer(
        origin + pathname,
        {
            method: 'GET',
            headers: { [ISR_BYPASS_HEADER]: '1' },
            MAX_FETCH_TIME: 30_000,
        },
        false,
    );
    const html = await res.text();
    await setCacheWithOptions(`isr:${pathname}`, html, {
        ttl: revalidate * 1000,
        swr: ISR_SWR_MAX,
        tags,
    });
    return html;
};

/**
 * Serve an ISR page's cached full-HTML artifact with stale-while-revalidate:
 * fresh hits return immediately; stale hits return the stale artifact and kick
 * off one coalesced background regeneration; a cold miss renders on demand.
 */
export const serveIsr = async (
    origin: string,
    pathname: string,
    revalidate: number,
    tags?: string[],
): Promise<string> => {
    const key = `isr:${pathname}`;
    const entry = await getCacheEntry<string>(key);
    if (entry) {
        if (entry.staleAt === null || Date.now() < entry.staleAt) {
            return entry.value;
        }
        singleFlight(key, () =>
            regenerateIsr(origin, pathname, revalidate, tags),
        ).catch(() => undefined);
        return entry.value;
    }
    return singleFlight(key, () =>
        regenerateIsr(origin, pathname, revalidate, tags),
    );
};

// Shape of `prerender-manifest.json` written by the build crawler into the
// server output directory.
type PrerenderManifest = {
    isr?: {
        pathname: string;
        revalidate: number;
        tags?: string[];
        file: string;
    }[];
};

// Seed prerendered ISR artifacts into the cache so the first request after a
// (re)start serves the build-time HTML, then revalidates per its interval.
export const seedIsrFromManifest = async (serverDir: string): Promise<void> => {
    let raw: string;
    try {
        raw = await readFile(`${serverDir}/prerender-manifest.json`, 'utf-8');
    } catch {
        return; // no ISR pages were prerendered
    }
    let manifest: PrerenderManifest;
    try {
        manifest = JSON.parse(raw);
    } catch {
        return;
    }
    for (const entry of manifest.isr ?? []) {
        try {
            const html = await readFile(`${serverDir}/${entry.file}`, 'utf-8');
            await setCacheWithOptions(`isr:${entry.pathname}`, html, {
                ttl: (entry.revalidate || 60) * 1000,
                swr: ISR_SWR_MAX,
                tags: entry.tags,
            });
        } catch (err) {
            // Skip a missing/unreadable artifact.
            logger.debug(
                {
                    file: entry.file,
                    pathname: entry.pathname,
                    err: String(err),
                },
                'Skipping missing/unreadable ISR prerender artifact',
            );
        }
    }
};

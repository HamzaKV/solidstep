import { sitemap } from 'solidstep/utils/metadata';

export default () =>
    sitemap([
        { url: 'https://example.com/', changeFrequency: 'daily', priority: 1 },
        { url: 'https://example.com/about' },
    ]);

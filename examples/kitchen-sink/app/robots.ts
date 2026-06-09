import { robots } from 'solidstep/utils/metadata';

export default () =>
    robots({
        rules: { userAgent: '*', allow: '/', disallow: '/admin' },
        sitemap: 'https://example.com/sitemap.xml',
    });

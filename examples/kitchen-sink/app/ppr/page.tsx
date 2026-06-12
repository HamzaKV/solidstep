import { options as defineOptions } from 'solidstep/utils/options';

// Partial prerendering: the shell (this static page + the layout, with the
// @now slot showing its loading fallback) is prerendered at build time; the
// @now island is filled on the client per request.
export const options = defineOptions({ render: 'ppr' });

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'PPR — Kitchen Sink',
    },
});

export default function PprPage() {
    return <p data-testid='ppr-static'>static-shell-content</p>;
}

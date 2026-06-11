import { options as defineOptions } from 'solidstep/utils/options';

// Fully static: prerendered to .output/public/ssg/index.html at build time.
export const options = defineOptions({ render: 'static' });

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'SSG — Kitchen Sink',
    },
});

export default function SsgPage() {
    return (
        <section>
            <h1 data-testid='heading'>SSG</h1>
            <p data-testid='ssg'>static-content</p>
        </section>
    );
}

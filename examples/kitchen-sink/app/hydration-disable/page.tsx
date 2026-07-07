import { options as defineOptions } from 'solidstep/utils/options';
import { Link } from 'solidstep/link';

// hydration.disable: this route ships zero framework JS. <Link> degrades to
// a plain anchor (full page load) since no client router hydrates here.
export const options = defineOptions({ hydration: { disable: true } });

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Hydration Disabled — Kitchen Sink',
    },
});

const HydrationDisablePage = () => (
    <section data-testid='content'>
        <h1 data-testid='heading'>Static, no hydration</h1>
        <p data-testid='body'>
            This route has hydration.disable set — no client JS ships for it.
        </p>
        <Link href='/' data-testid='home-link'>
            Home
        </Link>
    </section>
);

export default HydrationDisablePage;

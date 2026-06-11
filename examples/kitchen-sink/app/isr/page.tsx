import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';
import { options as defineOptions } from 'solidstep/utils/options';

// Module-level counter: bumps on every real render. Under ISR the artifact is
// served from cache and only regenerated in the background after `revalidate`
// seconds, so the value advances across revalidations rather than per request.
let runs = 0;

export const loader = defineLoader(async () => {
    runs += 1;
    return { n: runs };
});

// Incremental Static Regeneration: revalidate at most once per second.
export const options = defineOptions({ render: 'isr', revalidate: 1 });

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'ISR — Kitchen Sink',
    },
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function IsrPage(props: { loaderData: LoaderData }) {
    return (
        <section>
            <h1 data-testid='heading'>ISR</h1>
            <p data-testid='isr-value'>n:{props.loaderData.n}</p>
        </section>
    );
}

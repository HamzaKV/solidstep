import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// A plain sequential loader (NOT `type: 'defer'`) so this route takes the
// non-streaming "loading shell then swap" path in server.ts rather than the
// renderToStream path. The short delay ensures the loading boundary is flushed
// before the real content swaps in.
export const loader = defineLoader(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { ready: true };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

// `generateMeta` lets the e2e suite assert head/meta integrity survives the
// non-destructive head swap.
export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Loading Swap — Kitchen Sink',
    },
    description: {
        type: 'meta',
        attributes: {
            name: 'description',
            content: 'Loading swap head-merge fixture',
        },
    },
});

const LoadingSwapPage = (props: { loaderData: LoaderData }) => {
    return (
        <section>
            <h1 data-testid='heading'>Loading Swap</h1>
            <p data-testid='swap-content'>
                loaded: {String(props.loaderData.ready)}
            </p>
        </section>
    );
};

export default LoadingSwapPage;

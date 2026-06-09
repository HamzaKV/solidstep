import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        // Simulate a slow data source so the shell streams before this resolves.
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { message: 'deferred-content-loaded' };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

// A deferred loader is exposed to the component as an accessor (a Solid
// resource). Reading it suspends until the data streams in; the framework wraps
// the page in <Suspense> using loading.tsx as the fallback.
export default function DeferredPage(props: {
    loaderData: () => LoaderData | undefined;
}) {
    return <p data-testid='deferred-content'>{props.loaderData()?.message}</p>;
}

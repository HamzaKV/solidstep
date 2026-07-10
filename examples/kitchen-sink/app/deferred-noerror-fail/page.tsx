import { defineLoader } from 'solidstep/utils/loader';

// Deliberately NO error.tsx here (unlike ../deferred-fail) -- this fixture
// pins what happens when a deferred loader with no ErrorBoundary throws:
// Solid's renderToStream onError has nothing local to catch it.
export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        throw new Error('unboundaried-deferred-failure');
    },
    { type: 'defer' },
);

export default function DeferredNoErrorFailPage(props: {
    loaderData: () => unknown;
}) {
    return (
        <p data-testid='deferred-noerror-fail-content'>
            {String(props.loaderData())}
        </p>
    );
}

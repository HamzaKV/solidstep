import { defineLoader } from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        // Simulate a slow data source so the shell streams before this rejects.
        await new Promise((resolve) => setTimeout(resolve, 100));
        throw new Error('deferred-page-failed');
    },
    { type: 'defer' },
);

export default function DeferredFailPage(props: { loaderData: () => unknown }) {
    return (
        <p data-testid='deferred-fail-content'>{String(props.loaderData())}</p>
    );
}

import type { JSX } from 'solid-js';
import { defineLoader } from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        // Simulate a slow data source so the shell streams before this rejects.
        await new Promise((resolve) => setTimeout(resolve, 100));
        throw new Error('deferred-layout-failed');
    },
    { type: 'defer' },
);

export default function DeferredLayoutFail(props: {
    children: () => JSX.Element;
    loaderData: () => unknown;
}) {
    return (
        <section data-testid='deferred-layout-fail'>
            <p data-testid='deferred-layout-fail-greeting'>
                {String(props.loaderData())}
            </p>
            {props.children()}
        </section>
    );
}

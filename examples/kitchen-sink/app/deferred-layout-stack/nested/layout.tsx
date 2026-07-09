import type { JSX } from 'solid-js';
import { defineLoader } from 'solidstep/utils/loader';

// Inner layout in the stack -- fails. The outer layout (../layout.tsx)
// succeeds, so this isolates whether the INNER layout's own error correctly
// reaches the shared route-level error.tsx (layouts have no per-node
// error.tsx; see server/render.ts's compose loop), rather than being lost
// or garbled by an id-collision with the outer layout's own (successful)
// deferred resource.
export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('nested-stacked-layout-failed');
    },
    { type: 'defer' },
);

export default function NestedDeferredLayoutStack(props: {
    children: () => JSX.Element;
    loaderData: () => unknown;
}) {
    return (
        <section data-testid='nested-deferred-layout-stack'>
            <p data-testid='nested-deferred-layout-stack-greeting'>
                {String(props.loaderData())}
            </p>
            {props.children()}
        </section>
    );
}

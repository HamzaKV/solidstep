import type { JSX } from 'solid-js';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// Outer layout in a two-deferred-layout stack (see nested/layout.tsx) --
// succeeds, so any error shown for this route must come from the nested
// layout, not this one.
export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { greeting: 'hello-from-outer-stacked-layout' };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function DeferredLayoutStack(props: {
    children: () => JSX.Element;
    loaderData: () => LoaderData | undefined;
}) {
    return (
        <section data-testid='deferred-layout-stack'>
            <p data-testid='deferred-layout-stack-greeting'>
                {props.loaderData()?.greeting}
            </p>
            {props.children()}
        </section>
    );
}

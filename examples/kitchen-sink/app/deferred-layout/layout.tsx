import type { JSX } from 'solid-js';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        // Simulate a slow data source so the shell streams before this resolves.
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { greeting: 'hello-from-deferred-layout' };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function DeferredLayout(props: {
    children: () => JSX.Element;
    loaderData: () => LoaderData | undefined;
}) {
    return (
        <section data-testid='deferred-layout'>
            <p data-testid='deferred-layout-greeting'>
                {props.loaderData()?.greeting}
            </p>
            {props.children()}
        </section>
    );
}

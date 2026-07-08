import type { JSX } from 'solid-js';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { greeting: 'combo-layout-loaded' };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function DeferredComboLayout(props: {
    children: () => JSX.Element;
    loaderData: () => LoaderData | undefined;
}) {
    return (
        <section data-testid='deferred-combo-layout'>
            <p data-testid='deferred-combo-layout-greeting'>
                {props.loaderData()?.greeting}
            </p>
            {props.children()}
        </section>
    );
}

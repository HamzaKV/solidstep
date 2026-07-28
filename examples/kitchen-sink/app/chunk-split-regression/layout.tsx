import type { JSX } from 'solid-js';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';
import { redirect } from 'solidstep/utils/redirect';
import { heavyFn1, heavyFn2, heavyFn3 } from './heavy-dep';

// Regression fixture for the cross-chunk missing-import bug: a loader that
// calls a sibling function EXPORTED FROM THE SAME FILE, which itself calls
// ANOTHER sibling function that also calls an external solidstep import -
// matching axis's exact original shape (resolveAuthenticatedUser +
// loadAuthenticatedUser). Multiple distinct child routes share this layout
// so vinxi's per-route SSR build generates several different compiled
// chunks that each need these helpers - the bug was that some of those
// chunks kept the call but dropped the import, throwing a ReferenceError.
export const resolveName = (name: string | null) => {
    if (!name) {
        redirect('/login');
        return null;
    }
    return name;
};

export const greetingFor = (name: string) =>
    `hello, ${resolveName(name)} ${heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}`;

export const loader = defineLoader(async () => {
    return { greeting: greetingFor('chunk-split-regression') };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function ChunkSplitRegressionLayout(props: {
    children: () => JSX.Element;
    loaderData: LoaderData;
}) {
    return (
        <section data-testid='chunk-split-regression-layout'>
            <p data-testid='chunk-split-regression-greeting'>
                {props.loaderData.greeting}
            </p>
            {props.children()}
        </section>
    );
}

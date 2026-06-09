import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// Module-level counter: increments each time the loader actually runs. With
// caching enabled, repeated requests reuse the first value, so it stays at 1.
let runs = 0;

export const loader = defineLoader(
    async () => {
        runs += 1;
        return { value: runs };
    },
    { cache: { ttl: 60_000 } },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function CachedPage(props: { loaderData: LoaderData }) {
    return <p data-testid='cached-value'>value:{props.loaderData.value}</p>;
}

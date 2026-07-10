import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// A boundary group with a REGULAR (non-defer) loader on a PPR page. The render
// engine still emits it as a client-filled hole (the shell can't resolve group
// resources synchronously), so the hole endpoint must serve non-defer group
// loaders too — this fixture pins that regression.
export const loader = defineLoader(async () => {
    return { fresh: 'fresh-group-data' };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function FreshSlot(props: {
    loaderData: () => LoaderData | undefined;
}) {
    return <p data-testid='fresh-value'>{props.loaderData()?.fresh}</p>;
}

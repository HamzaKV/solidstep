import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// The dynamic hole. A module counter proves it runs per request (filled on the
// client via the loader endpoint), not frozen into the prerendered shell.
let ticks = 0;

export const loader = defineLoader(
    async () => {
        ticks += 1;
        return { tick: ticks };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function NowSlot(props: {
    loaderData: () => LoaderData | undefined;
}) {
    return <p data-testid='now-value'>tick:{props.loaderData()?.tick}</p>;
}

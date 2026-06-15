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
        // `when` is a Date so the e2e suite can prove the hole endpoint preserves
        // non-JSON types (Date/Map/Set) via seroval — a plain-JSON hole would
        // deliver this back to the client as a string.
        return { tick: ticks, when: new Date('2024-01-02T03:04:05.000Z') };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function NowSlot(props: {
    loaderData: () => LoaderData | undefined;
}) {
    const when = () => props.loaderData()?.when;
    return (
        <>
            <p data-testid='now-value'>tick:{props.loaderData()?.tick}</p>
            <span data-testid='now-when'>
                {when() instanceof Date
                    ? (when() as Date).toISOString()
                    : `not-a-date:${typeof when()}`}
            </span>
        </>
    );
}

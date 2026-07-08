import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { greeting: 'combo-page-loaded' };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function DeferredComboPage(props: {
    loaderData: () => LoaderData | undefined;
}) {
    return (
        <p data-testid='deferred-combo-page-greeting'>
            {props.loaderData()?.greeting}
        </p>
    );
}

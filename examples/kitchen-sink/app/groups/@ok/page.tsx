import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { msg: 'ok-group-content' };
    },
    { type: 'defer' },
);

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function OkGroup(props: {
    loaderData: () => LoaderData | undefined;
}) {
    return <p data-testid='group-ok'>{props.loaderData()?.msg}</p>;
}

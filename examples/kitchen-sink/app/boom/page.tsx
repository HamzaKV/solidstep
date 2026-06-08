import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    throw new Error('kaboom from the loader');
    // biome-ignore lint/correctness/noUnreachable: intentional fixture — the loader throws to exercise the error boundary; this return only shapes LoaderData for the type below.
    return { never: true };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const BoomPage = (props: { loaderData: LoaderData }) => {
    return <p>{String(props.loaderData.never)}</p>;
};

export default BoomPage;

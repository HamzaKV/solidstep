import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    throw new Error('kaboom from the loader');
    // eslint-disable-next-line no-unreachable
    return { never: true };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const BoomPage = (props: { loaderData: LoaderData }) => {
    return <p>{String(props.loaderData.never)}</p>;
};

export default BoomPage;

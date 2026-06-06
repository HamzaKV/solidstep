import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    return { visitors: 1234 };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const AnalyticsSlot = (props: { loaderData: LoaderData }) => {
    return <span data-testid="analytics-visitors">{props.loaderData.visitors}</span>;
};

export default AnalyticsSlot;

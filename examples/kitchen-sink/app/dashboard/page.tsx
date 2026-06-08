import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    return { title: 'Overview' };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const DashboardPage = (props: { loaderData: LoaderData }) => {
    return <p data-testid='dashboard-page'>{props.loaderData.title}</p>;
};

export default DashboardPage;

import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    return { message: 'hello from the home loader' };
});

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Kitchen Sink — Home',
    },
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const HomePage = (props: { loaderData: LoaderData }) => {
    return (
        <section>
            <h1 data-testid="heading">Kitchen Sink</h1>
            <p data-testid="loader-message">{props.loaderData.message}</p>
        </section>
    );
};

export default HomePage;

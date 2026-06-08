import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    // Simulate a slow data source so the loading.tsx boundary is exercised.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { ready: true };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const SlowPage = (props: { loaderData: LoaderData }) => {
    return (
        <section>
            <h1 data-testid='heading'>Slow Page</h1>
            <p data-testid='slow-content'>
                loaded: {String(props.loaderData.ready)}
            </p>
        </section>
    );
};

export default SlowPage;

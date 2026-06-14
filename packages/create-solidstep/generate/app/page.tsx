import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// Loaders run on the server only; their data is passed to the page as a prop.
// Non-JSON values (Date/Map/Set/BigInt) survive to the client too.
export const loader = defineLoader(async () => {
    return { framework: 'SolidStep', renderedAt: new Date() };
});

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Home · SolidStep',
    },
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function Home(props: { loaderData: LoaderData }) {
    return (
        <section>
            <h1>Welcome to {props.loaderData.framework}</h1>
            <p>
                Edit <code>app/page.tsx</code> to get started.
            </p>
            <p>
                Server-rendered at{' '}
                <time>{props.loaderData.renderedAt.toLocaleTimeString()}</time>.
            </p>
        </section>
    );
}

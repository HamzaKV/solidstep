import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/2');
    if (!response.ok) {
        throw new Error('Failed to fetch data');
    }
    const data = (await response.json()) as {
        userId: number;
        id: number;
        title: string;
        completed: boolean;
    };
    return data;
});

export const generateMeta = () => ({
    'title': {
        type: 'title',
        attributes: {},
        content: 'SolidStep Main Page'
    },
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const Page = (props: { loaderData: LoaderData }) => {
    return (
        <main>
            <h1>Welcome to SolidStep</h1>
            <p>Edit <code>app/page.tsx</code> to get started.</p>
            <p>Loaded todo #{props.loaderData.id}: {props.loaderData.title}</p>
        </main>
    );
};

export default Page;

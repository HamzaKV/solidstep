import { defineLoader } from '../utils/loader';
import { NoHydration } from 'solid-js/web';

export const loader = defineLoader(async () => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/2');
    if (!response.ok) {
        throw new Error('Failed to fetch data');
    }
    console.log('Fetching data from API...');
    const data = await response.json() as Promise<{ userId: number; id: number; title: string; completed: boolean }>;
    return data;
});

export const generateMeta = () => ({
    'title': {
        type: 'title',
        attributes: {},
        content: 'SolidStep Example Main Page'
    },
});

type LoaderData = Awaited<ReturnType<Exclude<typeof loader, null>>>['data'];

const Page = ({
    loaderData
}: {
    loaderData: LoaderData;
}) => {
    return (
        <div class="flex flex-col items-center justify-center min-h-screen bg-gray-100">
            <NoHydration>
                <p class="text-lg text-gray-700">ID: {loaderData.id}</p>
            </NoHydration>
            <h1 class="text-4xl font-bold mb-4">Welcome to My App</h1>
            <p class="text-lg text-gray-700">This is a simple Next.js application.</p>
        </div>
    );
};

export default Page;

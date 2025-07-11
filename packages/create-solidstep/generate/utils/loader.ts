import { isServer } from 'solid-js/web';

type LoaderFunction<T> = (request?: Request) => Promise<T>;

type LoaderOptions = {
    type?: 'defer' | 'sequential';
};

export const defineLoader = <T>(loader: LoaderFunction<T>, options?: LoaderOptions) => {
    if (isServer) {
        return async (request?: Request) => {
            try {
                const loaderData = await loader(request);
                return {
                    data: loaderData,
                    type: options?.type || 'sequential',
                };
            } catch (error) {
                console.error('Error in loader:', error);
                throw error; // Re-throw to allow error handling upstream
            }
        };
    }

    return null; // Return null if not on the server
};

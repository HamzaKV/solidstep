export type Options = {
    cache?: {
        ttl?: number;
    };
    responseHeaders?: {
        [key: string]: string;
    };
    hydration?: {
        disable?: boolean;
        blockRender?: boolean;
        fetchPriority?: 'high' | 'low' | 'auto';
    };
};

export const options = (options: Options) => options; 

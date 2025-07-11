
export type Meta = {
    [key: string]: {
        type: 'link' | 'meta' | 'script' | 'style' | 'title';
        attributes: Record<string, string>;
        content?: string; 
    };
};

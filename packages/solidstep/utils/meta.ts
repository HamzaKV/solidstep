
export type Meta = {
    [key: string]: {
        type: 'link' | 'meta' | 'script' | 'style' | 'title';
        attributes: Record<string, string>;
        content?: string; 
    };
};

type MetaFunctionParameters = {
    req: Request;
    cspNonce?: string;
};
export type MetaFunction = (params: MetaFunctionParameters) => 
    Promise<Meta> | Meta;

export const meta = (metaFunction: MetaFunction) => metaFunction;

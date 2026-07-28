import { heavyFn1, heavyFn2, heavyFn3 } from '../heavy-dep';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async (req) => {
    const url = new URL(req.url);
    const id = url.pathname.split('/').pop();
    return { value: id ?? 'unknown' };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function ChunkSplitRegressionId(props: {
    loaderData: LoaderData;
}) {
    return (
        <p data-testid='chunk-split-regression-id'>
            {heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}
            {props.loaderData.value}
        </p>
    );
}

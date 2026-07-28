import { heavyFn1, heavyFn2, heavyFn3 } from '../heavy-dep';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => ({ value: 'c' }));

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function ChunkSplitRegressionC(props: {
    loaderData: LoaderData;
}) {
    return (
        <p data-testid='chunk-split-regression-c'>
            {heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}
            {props.loaderData.value}
        </p>
    );
}

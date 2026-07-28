import { heavyFn1, heavyFn2, heavyFn3 } from '../heavy-dep';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => ({ value: 'f' }));

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function ChunkSplitRegressionf(props: {
    loaderData: LoaderData;
}) {
    return (
        <p data-testid='chunk-split-regression-f'>
            {heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}
            {props.loaderData.value}
        </p>
    );
}

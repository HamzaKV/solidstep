import { heavyFn1, heavyFn2, heavyFn3 } from '../heavy-dep';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => ({ value: 'k' }));

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function ChunkSplitRegressionk(props: {
    loaderData: LoaderData;
}) {
    return (
        <p data-testid='chunk-split-regression-k'>
            {heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}
            {props.loaderData.value}
        </p>
    );
}

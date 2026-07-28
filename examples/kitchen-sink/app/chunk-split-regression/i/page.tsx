import { heavyFn1, heavyFn2, heavyFn3 } from '../heavy-dep';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => ({ value: 'i' }));

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function ChunkSplitRegressioni(props: {
    loaderData: LoaderData;
}) {
    return (
        <p data-testid='chunk-split-regression-i'>
            {heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}
            {props.loaderData.value}
        </p>
    );
}

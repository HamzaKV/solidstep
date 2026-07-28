import { heavyFn1, heavyFn2, heavyFn3 } from '../heavy-dep';
export default function ChunkSplitRegressionA() {
    return (
        <p data-testid='chunk-split-regression-a'>
            {heavyFn1(1) + heavyFn2(2) + heavyFn3(3)}a
        </p>
    );
}

import { options as defineOptions } from 'solidstep/utils/options';
import type { GenerateStaticParams } from 'solidstep/utils/prerender';

// Static + dynamic: generateStaticParams enumerates which ids to prerender.
export const options = defineOptions({ render: 'static' });

export const generateStaticParams: GenerateStaticParams = () => [
    { id: '1' },
    { id: '2' },
];

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Product — Kitchen Sink',
    },
});

export default function ProductPage(props: { routeParams: { id: string } }) {
    return (
        <section>
            <h1 data-testid='heading'>Product</h1>
            <p data-testid='product-id'>id:{props.routeParams.id}</p>
        </section>
    );
}

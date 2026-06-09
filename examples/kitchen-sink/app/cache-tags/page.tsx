import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';
import { options as defineOptions } from 'solidstep/utils/options';
import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { revalidateProducts } from './actions';

// Module-level counter: increments each time the loader actually runs. While the
// loader's data is cached the value sticks; invalidating its `products` tag
// drops the entry, so the next run bumps it.
let runs = 0;

export const loader = defineLoader(
    async () => {
        runs += 1;
        return { value: runs };
    },
    {
        cache: {
            ttl: 60_000, // fresh for 60s (wall-clock)
            swr: 600_000, // then serve stale up to 10 more min while revalidating
            tags: ['products'], // group-invalidate via invalidateTag('products')
        },
    },
);

// Render-cache the page too. revalidatePath() relies on this cached HTML to diff
// the refreshed page into the live DOM. (Left untagged so invalidateTag doesn't
// drop it before the diff reads the old HTML.)
export const options = defineOptions({
    cache: { ttl: 60_000, swr: 600_000 },
});

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Cache Tags — Kitchen Sink',
    },
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function CacheTagsPage(props: { loaderData: LoaderData }) {
    const [state, formAction, pending] = useActionState(revalidateProducts, {
        revalidations: 0,
    });

    return (
        <section>
            <h1 data-testid='heading'>Cache Tags</h1>
            <p data-testid='cached-value'>value:{props.loaderData.value}</p>
            <p data-testid='revalidations'>
                revalidations:{state().revalidations}
            </p>
            <Form action={formAction}>
                <button
                    data-testid='revalidate'
                    type='submit'
                    disabled={pending()}
                >
                    {pending() ? 'Revalidating…' : 'Invalidate "products"'}
                </button>
            </Form>
        </section>
    );
}

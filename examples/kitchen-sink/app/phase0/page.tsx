import { createSignal, onMount } from 'solid-js';
import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

// Increments every time the loader actually runs. This page sets NO cache
// option, so a correct framework runs the loader on every request (the default
// dynamic page must not be cached). If it were wrongly cached forever, the
// value would stick at 1.
let runs = 0;

// A string crafted to break out of the inline hydration <script> if loader data
// is embedded unescaped. With escaping, it stays inert inside the script.
const XSS = '</script><img src=x data-xss="1" onerror="window.__xss=1">';

export const loader = defineLoader(async (req?: Request) => {
    runs += 1;
    const q = req ? (new URL(req.url).searchParams.get('q') ?? '') : '';
    return {
        runs,
        q,
        // Non-JSON values: prove seroval reconstructs them on the client.
        when: new Date('2020-01-02T03:04:05.000Z'),
        tags: new Map<string, string>([['a', 'alpha']]),
        xss: XSS,
    };
});

export const generateMeta = () => ({
    // A meta value with a quote + tag that would break out of the attribute or
    // inject a script if attribute values were not HTML-escaped.
    description: {
        type: 'meta',
        attributes: {
            name: 'description',
            content: '"><script>window.__metaxss=1</script>',
        },
    },
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function Phase0Page(props: {
    loaderData: LoaderData;
    searchParams: Record<string, string>;
}) {
    // These run only on the client after hydration, so they reflect the
    // deserialized loader data the client actually received.
    const [whenType, setWhenType] = createSignal('unknown');
    const [tagsType, setTagsType] = createSignal('unknown');
    const [tagsValue, setTagsValue] = createSignal('');
    onMount(() => {
        setWhenType(
            props.loaderData.when instanceof Date ? 'Date' : 'not-date',
        );
        setTagsType(props.loaderData.tags instanceof Map ? 'Map' : 'not-map');
        if (props.loaderData.tags instanceof Map) {
            setTagsValue(props.loaderData.tags.get('a') ?? '');
        }
    });

    return (
        <section>
            <h1 data-testid='heading'>Phase 0</h1>
            <p data-testid='runs'>{props.loaderData.runs}</p>
            <p data-testid='q'>{props.loaderData.q}</p>
            <p data-testid='search-q'>{props.searchParams.q ?? ''}</p>
            <p data-testid='xss'>{props.loaderData.xss}</p>
            <p data-testid='when-type'>{whenType()}</p>
            <p data-testid='tags-type'>{tagsType()}</p>
            <p data-testid='tags-value'>{tagsValue()}</p>
        </section>
    );
}

import type { PageProps } from 'solidstep/router';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Blog · SolidStep',
    },
});

// `PageProps<'/blog/[slug]'>` gives typed `routeParams` (here `{ slug: string }`)
// once the route types are generated (on `dev`/`build`).
export default function BlogPost(props: PageProps<'/blog/[slug]'>) {
    return (
        <article>
            <h1>Post: {props.routeParams.slug}</h1>
            <p>
                This is a dynamic route at <code>app/blog/[slug]/page.tsx</code>
                . The <code>slug</code> param is type-checked.
            </p>
        </article>
    );
}

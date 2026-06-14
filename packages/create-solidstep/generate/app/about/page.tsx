export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'About · SolidStep',
    },
});

export default function About() {
    return (
        <section>
            <h1>About</h1>
            <p>
                This page is server-rendered on every request. Export an{' '}
                <code>options</code> object with <code>render: 'static'</code>{' '}
                to prerender it at build time instead.
            </p>
        </section>
    );
}

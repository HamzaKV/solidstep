export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'About — Kitchen Sink',
    },
});

const AboutPage = () => {
    return (
        <section>
            <h1 data-testid='heading'>About</h1>
            <p data-testid='about-body'>
                A static page rendered under the root layout.
            </p>
        </section>
    );
};

export default AboutPage;

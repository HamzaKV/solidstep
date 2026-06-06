const DocsPage = (props: { routeParams: { path: string[] } }) => {
    const segments = props.routeParams.path ?? [];
    return (
        <section>
            <h1 data-testid="heading">Docs</h1>
            <p data-testid="path">{segments.join('/')}</p>
            <p data-testid="depth">{segments.length}</p>
        </section>
    );
};

export default DocsPage;

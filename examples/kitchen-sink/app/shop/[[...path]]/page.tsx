const ShopPage = (props: { routeParams: { path?: string[] } }) => {
    const segments = props.routeParams.path ?? [];
    return (
        <section>
            <h1 data-testid='heading'>Shop</h1>
            <p data-testid='path'>
                {segments.length === 0 ? '(root)' : segments.join('/')}
            </p>
        </section>
    );
};

export default ShopPage;

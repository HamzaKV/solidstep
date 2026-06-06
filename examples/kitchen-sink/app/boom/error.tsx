const BoomError = (props: { error?: Error }) => {
    return (
        <section>
            <h1 data-testid="heading">Something went wrong</h1>
            <p data-testid="error-message">{props.error?.message ?? 'unknown error'}</p>
        </section>
    );
};

export default BoomError;

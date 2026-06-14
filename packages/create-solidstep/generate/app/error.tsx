// Rendered when a page or its loader throws. Receives the thrown `error`.
export default function ErrorPage(props: { error?: { message?: string } }) {
    return (
        <section>
            <h1>Something went wrong</h1>
            <p>{props.error?.message ?? 'An unexpected error occurred.'}</p>
        </section>
    );
}

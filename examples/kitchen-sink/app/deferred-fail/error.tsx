export default function DeferredFailError(props: { error?: Error }) {
    return (
        <p data-testid='deferred-fail-error'>
            page error: {props.error?.message}
        </p>
    );
}

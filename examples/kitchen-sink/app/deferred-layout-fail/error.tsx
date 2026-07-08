export default function DeferredLayoutFailError(props: { error?: Error }) {
    return (
        <p data-testid='deferred-layout-fail-error'>
            layout error: {props.error?.message}
        </p>
    );
}

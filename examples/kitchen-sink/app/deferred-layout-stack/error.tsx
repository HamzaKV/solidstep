export default function DeferredLayoutStackError(props: { error?: Error }) {
    return (
        <p data-testid='deferred-layout-stack-error'>
            stack error: {props.error?.message}
        </p>
    );
}

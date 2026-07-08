export default function BoomDeferredGroupError(props: { error?: Error }) {
    return (
        <p data-testid='group-boomdeferred-error'>
            group error: {props.error?.message}
        </p>
    );
}

export default function BoomGroupError(props: { error?: Error }) {
    return (
        <p data-testid='group-boom-error'>
            group error: {props.error?.message}
        </p>
    );
}

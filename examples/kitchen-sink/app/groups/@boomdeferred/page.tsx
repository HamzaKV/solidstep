import { defineLoader } from 'solidstep/utils/loader';

export const loader = defineLoader(
    async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        throw new Error('boom-deferred-group-failed');
    },
    { type: 'defer' },
);

export default function BoomDeferredGroup(props: {
    loaderData: () => unknown;
}) {
    return <p data-testid='group-boomdeferred'>{String(props.loaderData())}</p>;
}

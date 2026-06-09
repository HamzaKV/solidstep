import { defineLoader } from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    throw new Error('boom-group-failed');
});

export default function BoomGroup(props: { loaderData: () => unknown }) {
    // Reading the errored resource throws, which the group's error.tsx catches.
    return <p data-testid='group-boom'>{String(props.loaderData())}</p>;
}

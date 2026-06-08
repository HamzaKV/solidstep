import {
    defineLoader,
    type LoaderDataFromFunction,
} from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
    return { members: ['Ada', 'Linus', 'Grace'] };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

const TeamSlot = (props: { loaderData: LoaderData }) => {
    return (
        <span data-testid='team-count'>{props.loaderData.members.length}</span>
    );
};

export default TeamSlot;

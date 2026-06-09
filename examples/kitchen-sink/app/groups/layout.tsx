import type { JSX } from 'solid-js';

const GroupsLayout = (props: {
    children: () => JSX.Element;
    slots: { ok: () => JSX.Element; boom: () => JSX.Element };
}) => {
    return (
        <section data-testid='groups-layout'>
            <div data-testid='groups-main'>{props.children()}</div>
            <div data-testid='slot-ok'>{props.slots.ok()}</div>
            <div data-testid='slot-boom'>{props.slots.boom()}</div>
        </section>
    );
};

export default GroupsLayout;

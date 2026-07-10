import type { JSX } from 'solid-js';

// The PPR static shell: heading + page content are prerendered; the `now` slot
// is a dynamic hole filled on the client.
const PprLayout = (props: {
    children: () => JSX.Element;
    slots: { now: () => JSX.Element; fresh: () => JSX.Element };
}) => {
    return (
        <section data-testid='ppr-layout'>
            <h1 data-testid='heading'>PPR</h1>
            <div>{props.children()}</div>
            <div data-testid='slot-now'>{props.slots.now()}</div>
            <div data-testid='slot-fresh'>{props.slots.fresh()}</div>
        </section>
    );
};

export default PprLayout;

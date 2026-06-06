import type { JSX } from 'solid-js';

const DashboardLayout = (props: {
    children: () => JSX.Element;
    slots: { analytics: () => JSX.Element; team: () => JSX.Element };
}) => {
    return (
        <section data-testid="dashboard-layout">
            <h1 data-testid="heading">Dashboard</h1>
            <div>{props.children()}</div>
            <aside>
                <div data-testid="slot-analytics">{props.slots.analytics()}</div>
                <div data-testid="slot-team">{props.slots.team()}</div>
            </aside>
        </section>
    );
};

export default DashboardLayout;

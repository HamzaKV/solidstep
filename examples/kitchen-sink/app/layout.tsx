import { type Component, type JSX, Show } from 'solid-js';
import { Link } from 'solidstep/link';
import { navigationPending } from 'solidstep/router';
import './globals.css';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Kitchen Sink',
    },
    description: {
        type: 'meta',
        attributes: {
            name: 'description',
            content: 'SolidStep kitchen-sink example app for e2e testing.',
        },
    },
});

const RootLayout: Component<{ children: () => JSX.Element }> = (props) => {
    return (
        <body>
            {/* Global navigation-pending indicator, driven by the router signal. */}
            <Show when={navigationPending()}>
                <div data-testid='nav-progress'>Navigating…</div>
            </Show>
            <nav data-testid='nav'>
                <Link href='/'>Home</Link>
                <Link href='/about'>About</Link>
                <Link href='/counter'>Counter</Link>
                <Link href='/dashboard'>Dashboard</Link>
                <Link href='/cache-tags'>Cache Tags</Link>
                <Link href='/ssg'>SSG</Link>
                <Link href='/isr'>ISR</Link>
                <Link href='/ppr'>PPR</Link>
                <Link href='/slow'>Slow</Link>
                <Link href='/deferred'>Deferred</Link>
                <Link href='/groups'>Groups</Link>
            </nav>
            <main>{props.children()}</main>
        </body>
    );
};

export default RootLayout;

import { type Component, type JSX, Show } from 'solid-js';
import { Link } from 'solidstep/link';
import { navigationPending } from 'solidstep/router';
import './globals.css';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'SolidStep App',
    },
    description: {
        type: 'meta',
        attributes: {
            name: 'description',
            content: 'A SolidStep application.',
        },
    },
    favicon: {
        type: 'link',
        attributes: {
            rel: 'icon',
            href: '/favicon-32x32.png',
            type: 'image/png',
        },
    },
});

const Layout: Component<{ children: () => JSX.Element }> = (props) => {
    return (
        <body>
            {/* A tiny pending indicator while the next route's data loads. */}
            <Show when={navigationPending()}>
                <div class='nav-progress' />
            </Show>
            <header class='site-header'>
                {/* <Link> does client-side navigation (no full reload) and is
                    type-checked against your routes once you've run dev/build. */}
                <nav>
                    <Link href='/'>Home</Link>
                    <Link href='/about'>About</Link>
                    <Link href='/blog/hello-world'>Blog</Link>
                    <Link href='/contact'>Contact</Link>
                </nav>
            </header>
            <main>{props.children()}</main>
        </body>
    );
};

export default Layout;

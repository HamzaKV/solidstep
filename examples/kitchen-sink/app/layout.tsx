import type { Component, JSX } from 'solid-js';
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
            <nav data-testid='nav'>
                <a href='/'>Home</a>
                <a href='/about'>About</a>
                <a href='/counter'>Counter</a>
                <a href='/dashboard'>Dashboard</a>
                <a href='/cache-tags'>Cache Tags</a>
            </nav>
            <main>{props.children()}</main>
        </body>
    );
};

export default RootLayout;

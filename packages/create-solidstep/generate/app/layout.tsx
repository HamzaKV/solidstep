import type { Component, JSX } from 'solid-js';
import 'globals.css';

export const generateMeta = () => ({
    'title': {
        type: 'title',
        attributes: {},
        content: 'SolidStep App'
    },
    'description': {
        type: 'meta',
        attributes: { 
            name: 'description',
            content: 'This is simple SolidStep application.' 
        },
    },
    'favicon': {
        type: 'link',
        attributes: {
            rel: 'icon',
            href: '/favicon-32x32.png',
            type: 'image/png'
        }
    },
});

const Layout: Component<{ 
    children: JSX.Element;
}> = ({
    children,
}) => {
    return (
        <body>
            {children}
        </body>
    );
}

export default Layout;

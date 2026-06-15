import type { Component, JSX } from 'solid-js';

// A layout inside an organizational `(group)` folder. It wraps every route under
// `(marketing)` even though the `(marketing)` segment never appears in the URL.
const MarketingLayout: Component<{ children: () => JSX.Element }> = (props) => (
    <section data-testid='marketing-layout'>
        <p data-testid='marketing-banner'>marketing-group-layout</p>
        {props.children()}
    </section>
);

export default MarketingLayout;

// Lives at `app/(marketing)/pricing/page.tsx`. The `(marketing)` group folder is
// organizational only, so this route is served at `/pricing` (not
// `/(marketing)/pricing`).
export default function PricingPage() {
    return <h1 data-testid='pricing'>pricing-page</h1>;
}

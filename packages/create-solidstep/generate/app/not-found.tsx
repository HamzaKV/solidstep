import { Link } from 'solidstep/link';

// The root 404 page (rendered with a 404 status for unmatched routes).
export default function NotFound() {
    return (
        <section>
            <h1>404 — Not found</h1>
            <p>That page doesn't exist.</p>
            <Link href='/'>Go home</Link>
        </section>
    );
}

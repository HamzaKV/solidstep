const BlogPostPage = (props: { routeParams: { slug: string } }) => {
    return (
        <section>
            <h1 data-testid="heading">Blog Post</h1>
            <p data-testid="slug">{props.routeParams.slug}</p>
        </section>
    );
};

export default BlogPostPage;

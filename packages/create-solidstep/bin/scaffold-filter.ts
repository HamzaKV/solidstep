/**
 * Whether a template path should be copied into the scaffolded app.
 * Excludes `node_modules`/`.git` at any depth under `templateDir`.
 */
export const shouldIncludeInScaffold = (
    templateDir: string,
    src: string,
): boolean => {
    // `src` is absolute, so stripping `templateDir` leaves a leading path
    // separator (e.g. "/node_modules") — strip that too before comparing,
    // otherwise `startsWith('node_modules')` never matches.
    const relativePath = src.replace(templateDir, '').replace(/^[/\\]/, '');
    return (
        !relativePath.startsWith('node_modules') &&
        !/^\.git($|[/\\])/.test(relativePath)
    );
};

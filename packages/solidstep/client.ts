import { hydrate } from 'solid-js/web';
import 'vinxi/client';
import fileRoutes from 'vinxi/routes';
import { getManifest } from 'vinxi/manifest';
import { createDiffDOM } from './utils/diff-dom';

window.onpageshow = () => {
    const state = window.history.state;
    const key = `${window.location.pathname}:build-time`;
    const buildTimeMeta = document.querySelector('meta[name="x-build-time"]');
    const buildTime = buildTimeMeta ? Number.parseInt(buildTimeMeta.getAttribute('content') || '0', 10) : 0;
    const lastBuildTime = Number.parseInt(sessionStorage.getItem(key) || '0', 10);
    const diffString = sessionStorage.getItem(window.location.pathname);

    if (state?.revalidated && buildTime === lastBuildTime && diffString) {
        // we need to re-apply the diff from session storage
        const diff = JSON.parse(diffString);
        const dd = createDiffDOM();
        const didApply = dd.apply(document.body, diff);
        if (didApply) {
            const key = window.location.pathname;
            sessionStorage.setItem(key, JSON.stringify(diff));
            window.history.pushState({ revalidated: true }, '', window.location.href);
        }
        if (import.meta.env.DEV && !didApply) {
            console.error('The mutation was not applied, this seems to be an edge case.');
            console.error('Please raise an issue on GitHub describing your case.');
            console.error('The diff calculated:', diff);
        }
    }
    sessionStorage.setItem(key, buildTime.toString());
};

const importModule = async (routeModule: any) => {
    const manifest = getManifest('client');
    if ((import.meta as any).env.DEV) {
        return await manifest.inputs[routeModule.src].import();
    }
    return await routeModule.import();
};

export const main = async (
    modulePath: string,
    routeParams: Record<string, string> = {},
    searchParams: Record<string, string> = {},
    loaderDataManifest: Record<string, any> = {}
) => {
    // find the route that matches the path
    const pageModule = fileRoutes.find((route) => route.path === modulePath);
    if (!pageModule) {
        console.error(`No route found for path: ${modulePath}`);
        return;
    }
    const pageLoaderData = loaderDataManifest[modulePath];

    const segments = modulePath.split('/').slice(2);
    if (segments.at(0)) {
        segments.unshift('');
    }
    const layouts: any[] = [];
    const layoutLoaderData: any[] = [];
    const groups: Record<string, any> = {};
    for (let i = 0; i < segments.length; i++) {
        const path = `/${segments.slice(1, segments.length - i).join('/')}`;
        const loaderData = loaderDataManifest[`/layout${path}`];
        const layoutModule = fileRoutes.find((route) => {
            const routePath = `/${route.path.split('/').slice(2).join('/')}`;
            return routePath === path && (route as any).type === 'layout';
        });
        if (layoutModule) {
            layouts.unshift(layoutModule);
        }
        if (loaderData) {
            layoutLoaderData.unshift(loaderData);
        }
    }
    const groupModules = fileRoutes.filter((route) => {
        const parentPath = (route as any).parent || '';
        return parentPath === segments.join('/') && (route as any).type === 'group';
    });
    if (groupModules && groupModules.length > 0) {
        for (const groupModule of groupModules) {
            const groupName = groupModule.path.split('/').at(-1)?.replace('@', '');
            if (!groupName) continue;
            groups[groupName] = groupModule;
        }
    }
    const compose = layouts.reduceRight(
        (children, layout, index) => async () => {
            const { default: layoutModule } = await importModule(layout.$component);
            const loaderData = layoutLoaderData[index] || {};
            const slots: Record<string, any> = {};
            const slotPromises: Promise<any>[] = [children()];
            if (index === layouts.length - 1) {
                // last layout, we can render slots
                for (const [groupName, group] of Object.entries(groups)) {
                    slotPromises.push(
                        (async () => {
                            const { default: groupPage } = await importModule(group.$component);
                            const groupLoaderData = loaderDataManifest[group.path] || {};
                            slots[groupName] = () => groupPage({
                                routeParams,
                                searchParams,
                                loaderData: groupLoaderData,
                            });
                        })()
                    );
                }
            }
            const [childrenRendered] = await Promise.all(slotPromises);
            return () => layoutModule({
                children: childrenRendered,
                routeParams,
                searchParams,
                slots: slots,
                loaderData,
            });
        },
        async () => {
            const { default: page } = await importModule(pageModule.$component);
            return () => page({
                routeParams,
                searchParams,
                loaderData: pageLoaderData || {},
            });
        }
    );

    const composed = await compose();

    hydrate(() => composed(), document);
};

export default main;

import { hydrate } from 'solid-js/web';
import 'vinxi/client';
import fileRoutes from 'vinxi/routes';
import { getManifest } from 'vinxi/manifest';

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

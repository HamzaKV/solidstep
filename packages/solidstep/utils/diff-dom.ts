// constants.js
const ACTIONS = {
    ADD_ELEMENT: 'addElement',
    REMOVE_ELEMENT: 'removeElement',
    RELOCATE_ELEMENT: 'relocateElement',
    MODIFY_TEXT: 'modifyTextElement',
    REPLACE_ELEMENT: 'replaceElement',
    ADD_ATTRIBUTE: 'addAttribute',
    REMOVE_ATTRIBUTE: 'removeAttribute',
    MODIFY_ATTRIBUTE: 'modifyAttribute',
    MODIFY_VALUE: 'modifyValue',
    MODIFY_CHECKED: 'modifyChecked',
    MODIFY_SELECTED: 'modifySelected',
} as const;

const NODE_TYPES = {
    ELEMENT: 1,
    TEXT: 3,
    COMMENT: 8,
    DOCUMENT_FRAGMENT: 11,
} as const;

const SKIP_MODES = {
    CHILDREN: 'children',
    FULL: 'full',
} as const;

type SkipMode = (typeof SKIP_MODES)[keyof typeof SKIP_MODES];

type SkipPredicate = (
    domNode: Node | VirtualNode,
    virtualNode: VirtualNode,
) => boolean | SkipMode;
type PreDiffApplyHook = (info: { diff: DiffResult; node: Node }) =>
    | boolean
    | undefined;
type PostDiffApplyHook = (info: { diff: DiffResult; node: Node }) => void;
type FilterOuterDiffHook = (
    oldNode: VirtualNode,
    newNode: VirtualNode,
    diffs: DiffResult[],
) => DiffResult[] | undefined;
type TextDiffHook = (
    target: Node,
    currentData: string,
    oldValue: string,
    newValue: string,
) => void;

interface DiffOptions {
    skipSelector: string | null;
    skipPredicate: SkipPredicate | null;
    skipAttributes: string[];
    skipChildren: boolean;
    skipMode: SkipMode;
    debug: boolean;
    diffcap: number;
    valueDiffing: boolean;
    caseSensitive: boolean;
    preVirtualDiffApply: PreDiffApplyHook | null;
    postVirtualDiffApply: PostDiffApplyHook | null;
    preDiffApply: PreDiffApplyHook | null;
    postDiffApply: PostDiffApplyHook | null;
    filterOuterDiff: FilterOuterDiffHook | null;
    textDiff: TextDiffHook | null;
    document: Document | null;
}

const DEFAULT_OPTIONS: DiffOptions = {
    skipSelector: null,
    skipPredicate: null,
    skipAttributes: [],
    skipChildren: false,
    skipMode: SKIP_MODES.CHILDREN,
    debug: false,
    diffcap: Number.POSITIVE_INFINITY,
    valueDiffing: true,
    caseSensitive: false,
    preVirtualDiffApply: null,
    postVirtualDiffApply: null,
    preDiffApply: null,
    postDiffApply: null,
    filterOuterDiff: null,
    textDiff: null,
    document: typeof document !== 'undefined' ? document : null,
};

interface VirtualNode {
    nodeType: number;
    nodeName: string;
    route?: number[];
    data?: string;
    attributes?: Record<string, string>;
    value?: string;
    checked?: boolean;
    selected?: boolean;
    childNodes?: VirtualNode[];
    innerDone?: boolean;
    skipFull?: boolean;
}

interface DiffResult {
    action: string;
    route: number[];
    from?: number[];
    to?: number[];
    element?: VirtualNode;
    index?: number;
    name?: string;
    value?: string;
    oldValue?: string | boolean | VirtualNode;
    newValue?: string | boolean | VirtualNode;
}

const VOID_ELEMENTS = new Set([
    'AREA',
    'BASE',
    'BR',
    'COL',
    'EMBED',
    'HR',
    'IMG',
    'INPUT',
    'LINK',
    'META',
    'PARAM',
    'SOURCE',
    'TRACK',
    'WBR',
]);

const VOID_ELEMENTS_LOOKUP: Record<string, boolean> = {
    area: true,
    base: true,
    br: true,
    col: true,
    embed: true,
    hr: true,
    img: true,
    input: true,
    keygen: true,
    link: true,
    menuitem: true,
    meta: true,
    param: true,
    source: true,
    track: true,
    wbr: true,
} as const;

const tagRE =
    /<\s*\/*[a-zA-Z:_][a-zA-Z0-9:_\-.]*\s*(?:"[^"]*"['"]*|'[^']*'['"]*|[^'"/>])*\/*\s*>|<!--(?:.|\n|\r)*?-->/g;
const attrRE = /\s([^'"/\s><]+?)[\s/>]|([^\s=]+)=\s?("[^"]*"|'[^']*')/g;

const unescapeHTML = (string: string) => {
    return string
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
};

const parseTag = (
    tag: string,
    caseSensitive: boolean,
): { type: string; node: VirtualNode; voidElement: boolean } => {
    const res: VirtualNode = {
        nodeType: NODE_TYPES.ELEMENT,
        nodeName: '',
        attributes: {},
    };
    let voidElement = false;
    const type = 'tag';

    const tagMatch = tag.match(/<\/?([^\s]+?)[/\s>]/);
    if (tagMatch) {
        res.nodeName =
            caseSensitive || tagMatch[1] === 'svg'
                ? tagMatch[1]
                : tagMatch[1].toUpperCase();

        if (
            VOID_ELEMENTS_LOOKUP[tagMatch[1].toLowerCase()] ||
            tag.charAt(tag.length - 2) === '/'
        ) {
            voidElement = true;
        }

        if (res.nodeName.startsWith('!--')) {
            const endIndex = tag.indexOf('-->');
            return {
                type: 'comment',
                node: {
                    nodeName: '#comment',
                    nodeType: NODE_TYPES.COMMENT,
                    data: endIndex !== -1 ? tag.slice(4, endIndex) : '',
                },
                voidElement,
            };
        }
    }

    const reg = new RegExp(attrRE);
    let result = null;
    let done = false;
    while (!done) {
        result = reg.exec(tag);

        if (result === null) {
            done = true;
        } else if (result[0].trim()) {
            if (result[1]) {
                const attr = result[1].trim();
                let arr = [attr, ''];

                if (attr.indexOf('=') > -1) arr = attr.split('=');
                if (!res.attributes) res.attributes = {};
                res.attributes[arr[0]] = arr[1];
                reg.lastIndex--;
            } else if (result[2]) {
                if (!res.attributes) res.attributes = {};
                res.attributes[result[2]] = result[3]
                    .trim()
                    .substring(1, result[3].length - 1);
            }
        }
    }

    return {
        type,
        node: res,
        voidElement,
    };
};

const getNodeByRoute = (root: Node, route: number[]): Node | null => {
    let node: Node = root;
    for (const index of route) {
        if (!node.childNodes || !node.childNodes[index]) {
            return null;
        }
        node = node.childNodes[index];
    }
    return node;
};

const cloneRoute = (route: number[]): number[] => [...route];

const normalizeNodeName = (
    nodeName: string,
    caseSensitive: boolean,
): string => {
    return caseSensitive ? nodeName : nodeName.toUpperCase();
};

const isVoidElement = (nodeName: string): boolean => {
    return VOID_ELEMENTS.has(nodeName.toUpperCase());
};

const getElementKey = (node: VirtualNode): string | null => {
    if (node.nodeType !== NODE_TYPES.ELEMENT) return null;
    return node.attributes?.['data-key'] || node.attributes?.id || null;
};

const elementsMatch = (
    nodeA: VirtualNode,
    nodeB: VirtualNode,
    options: DiffOptions,
): boolean => {
    if (nodeA.nodeType !== nodeB.nodeType) return false;

    if (
        nodeA.nodeType === NODE_TYPES.TEXT ||
        nodeA.nodeType === NODE_TYPES.COMMENT
    ) {
        return nodeA.data === nodeB.data;
    }

    if (nodeA.nodeType === NODE_TYPES.ELEMENT) {
        const nameA = normalizeNodeName(nodeA.nodeName, options.caseSensitive);
        const nameB = normalizeNodeName(nodeB.nodeName, options.caseSensitive);
        return nameA === nameB;
    }

    return false;
};

const calculateSimilarity = (
    nodeA: VirtualNode,
    nodeB: VirtualNode,
    options: DiffOptions,
): number => {
    if (!elementsMatch(nodeA, nodeB, options)) return 0;

    if (nodeA.nodeType !== NODE_TYPES.ELEMENT) return 1;

    const attrsA = nodeA.attributes || {};
    const attrsB = nodeB.attributes || {};
    const allKeys = new Set([...Object.keys(attrsA), ...Object.keys(attrsB)]);

    if (allKeys.size === 0) return 1;

    let matches = 0;
    for (const key of allKeys) {
        if (attrsA[key] === attrsB[key]) matches++;
    }

    return matches / allKeys.size;
};

export const nodeToObj = (
    node: Node,
    options: Partial<DiffOptions> = {},
): VirtualNode | null => {
    if (!node) return null;

    const obj: VirtualNode = {
        nodeType: node.nodeType,
        nodeName: '',
        route: [],
    };

    if (node.nodeType === NODE_TYPES.TEXT) {
        obj.nodeName = '#text';
        obj.data = (node as Text).data || node.textContent || '';
    } else if (node.nodeType === NODE_TYPES.COMMENT) {
        obj.nodeName = '#comment';
        obj.data = (node as Comment).data || '';
    } else if (node.nodeType === NODE_TYPES.ELEMENT) {
        obj.nodeName = normalizeNodeName(
            node.nodeName,
            options.caseSensitive ?? false,
        );
        obj.attributes = {};

        const element = node as Element;
        if (element.attributes) {
            for (let i = 0; i < element.attributes.length; i++) {
                const attr = element.attributes[i];
                obj.attributes[attr.name] = attr.value;
            }
        }

        if (options.valueDiffing !== false) {
            const htmlElement = element as
                | HTMLInputElement
                | HTMLTextAreaElement
                | HTMLSelectElement;
            if (
                htmlElement.value !== undefined &&
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(obj.nodeName)
            ) {
                obj.value = htmlElement.value;
            }
            if (
                (htmlElement as unknown as HTMLInputElement).checked !==
                undefined
            ) {
                obj.checked = (
                    htmlElement as unknown as HTMLInputElement
                ).checked;
            }
            if (
                (htmlElement as unknown as HTMLOptionElement).selected !==
                undefined
            ) {
                obj.selected = (
                    htmlElement as unknown as HTMLOptionElement
                ).selected;
            }
        }

        if (!isVoidElement(obj.nodeName) && node.childNodes) {
            obj.childNodes = [];
            for (let i = 0; i < node.childNodes.length; i++) {
                const childObj = nodeToObj(node.childNodes[i], options);
                if (childObj) {
                    childObj.route = [...(obj.route || []), i];
                    obj.childNodes.push(childObj);
                }
            }
        }
    } else if (node.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT) {
        obj.nodeName = '#document-fragment';
        obj.childNodes = [];
        if (node.childNodes) {
            for (let i = 0; i < node.childNodes.length; i++) {
                const childObj = nodeToObj(node.childNodes[i], options);
                if (childObj) {
                    childObj.route = [i];
                    obj.childNodes.push(childObj);
                }
            }
        }
    }

    return obj;
};

export const stringToObj = (
    htmlString: string,
    options: Partial<DiffOptions> = {},
): VirtualNode => {
    const result: VirtualNode[] = [];
    let current: {
        type: string;
        node: VirtualNode;
        voidElement: boolean;
    } | null = null;
    let level = -1;
    const arr: { type: string; node: VirtualNode; voidElement: boolean }[] = [];
    let inComponent = false;
    let insideSvg = false;
    const caseSensitive = options.caseSensitive || false;
    const valueDiffing = options.valueDiffing !== false;

    if (htmlString.indexOf('<') !== 0) {
        const end = htmlString.indexOf('<');
        result.push({
            nodeType: NODE_TYPES.TEXT,
            nodeName: '#text',
            data: end === -1 ? htmlString : htmlString.substring(0, end),
        });
    }

    htmlString.replace(tagRE, (tag: string, index: number) => {
        if (inComponent) {
            if (tag !== `</${current!.node.nodeName}>`) {
                return '';
            }
            inComponent = false;
        }

        const isOpen = tag.charAt(1) !== '/';
        const isComment = tag.startsWith('<!--');
        const start = index + tag.length;
        const nextChar = htmlString.charAt(start);

        if (isComment) {
            const comment = parseTag(tag, caseSensitive).node;

            if (level < 0) {
                result.push(comment);
            } else {
                const parent = arr[level];
                if (parent && comment.nodeName) {
                    if (!parent.node.childNodes) {
                        parent.node.childNodes = [];
                    }
                    parent.node.childNodes.push(comment);
                }
            }

            if (!inComponent && nextChar !== '<' && nextChar) {
                const childNodes =
                    level === -1 ? result : arr[level]?.node.childNodes || [];
                const end = htmlString.indexOf('<', start);
                const data = unescapeHTML(
                    htmlString.slice(start, end === -1 ? undefined : end),
                );
                if (data) {
                    childNodes.push({
                        nodeType: NODE_TYPES.TEXT,
                        nodeName: '#text',
                        data,
                    });
                }
            }

            return '';
        }

        if (isOpen) {
            current = parseTag(tag, caseSensitive || insideSvg);
            current.node.nodeType = NODE_TYPES.ELEMENT;

            if (
                current.node.nodeName === 'SVG' ||
                current.node.nodeName === 'svg'
            ) {
                insideSvg = true;
            }

            level++;

            if (
                !current.voidElement &&
                !inComponent &&
                nextChar &&
                nextChar !== '<'
            ) {
                if (!current.node.childNodes) {
                    current.node.childNodes = [];
                }
                const endIndex = htmlString.indexOf('<', start);
                const data = unescapeHTML(
                    htmlString.slice(
                        start,
                        endIndex === -1 ? undefined : endIndex,
                    ),
                );
                current.node.childNodes.push({
                    nodeType: NODE_TYPES.TEXT,
                    nodeName: '#text',
                    data,
                });
                if (valueDiffing && current.node.nodeName === 'TEXTAREA') {
                    current.node.value = data;
                }
            }

            if (level === 0 && current.node.nodeName) {
                result.push(current.node);
            }

            const parent = arr[level - 1];
            if (parent && current.node.nodeName) {
                if (!parent.node.childNodes) {
                    parent.node.childNodes = [];
                }
                parent.node.childNodes.push(current.node);
            }
            arr[level] = current;
        }

        if (!isOpen || current?.voidElement) {
            if (
                level > -1 &&
                current &&
                (current.voidElement ||
                    (caseSensitive &&
                        current.node.nodeName === tag.slice(2, -1)) ||
                    (!caseSensitive &&
                        current.node.nodeName.toUpperCase() ===
                            tag.slice(2, -1).toUpperCase()))
            ) {
                level--;
                if (level > -1) {
                    if (
                        current.node.nodeName === 'SVG' ||
                        current.node.nodeName === 'svg'
                    ) {
                        insideSvg = false;
                    }
                    current = arr[level];
                }
            }

            if (!inComponent && nextChar !== '<' && nextChar) {
                const childNodes =
                    level === -1 ? result : arr[level]?.node.childNodes || [];

                const end = htmlString.indexOf('<', start);
                const data = unescapeHTML(
                    htmlString.slice(start, end === -1 ? undefined : end),
                );
                childNodes.push({
                    nodeType: NODE_TYPES.TEXT,
                    nodeName: '#text',
                    data,
                });
            }
        }
        return '';
    });

    if (result.length === 1) {
        return result[0];
    }

    return {
        nodeType: NODE_TYPES.DOCUMENT_FRAGMENT,
        nodeName: '#document-fragment',
        childNodes: result,
        route: [],
    };
};

export const objToNode = (
    obj: VirtualNode,
    options: Partial<DiffOptions> = {},
): Node | null => {
    const doc = options.document || DEFAULT_OPTIONS.document;
    if (!doc) {
        throw new Error('Document object is required for objToNode');
    }

    if (obj.nodeType === NODE_TYPES.TEXT) {
        return doc.createTextNode(obj.data || '');
    }

    if (obj.nodeType === NODE_TYPES.COMMENT) {
        return doc.createComment(obj.data || '');
    }

    if (obj.nodeType === NODE_TYPES.ELEMENT) {
        const element = doc.createElement(obj.nodeName);

        if (obj.attributes) {
            for (const key of Object.keys(obj.attributes)) {
                element.setAttribute(key, obj.attributes[key]);
            }
        }

        if (obj.value !== undefined) {
            (element as HTMLInputElement).value = obj.value;
        }
        if (obj.checked !== undefined) {
            (element as HTMLInputElement).checked = obj.checked;
        }
        if (obj.selected !== undefined) {
            (element as HTMLOptionElement).selected = obj.selected;
        }

        if (obj.childNodes) {
            for (const childObj of obj.childNodes) {
                const childNode = objToNode(childObj, options);
                if (childNode) {
                    element.appendChild(childNode);
                }
            }
        }

        return element;
    }

    if (obj.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT) {
        const fragment = doc.createDocumentFragment();
        if (obj.childNodes) {
            for (const childObj of obj.childNodes) {
                const childNode = objToNode(childObj, options);
                if (childNode) {
                    fragment.appendChild(childNode);
                }
            }
        }
        return fragment;
    }

    return null;
};

const matchesSimpleSelector = (
    node: VirtualNode,
    selector: string,
): boolean => {
    if (!selector || node.nodeType !== NODE_TYPES.ELEMENT) return false;

    const trimmedSelector = selector.trim();

    // Tag selector (e.g., "div", "span")
    if (/^[a-zA-Z][\w-]*$/.test(trimmedSelector)) {
        return (
            normalizeNodeName(node.nodeName, false) ===
            trimmedSelector.toUpperCase()
        );
    }

    // ID selector (e.g., "#myId")
    if (trimmedSelector.startsWith('#')) {
        const id = trimmedSelector.slice(1);
        return node.attributes?.id === id;
    }

    // Class selector (e.g., ".myClass")
    if (trimmedSelector.startsWith('.')) {
        const className = trimmedSelector.slice(1);
        const nodeClasses = node.attributes?.class?.split(/\s+/) || [];
        return nodeClasses.includes(className);
    }

    // Attribute selector (e.g., "[data-skip]", "[type='text']")
    const attrMatch = trimmedSelector.match(
        /^\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/,
    );
    if (attrMatch) {
        const [, attrName, attrValue] = attrMatch;
        if (attrValue !== undefined) {
            return node.attributes?.[attrName] === attrValue;
        }
        return node.attributes?.[attrName] !== undefined;
    }

    // Tag with class (e.g., "div.myClass")
    const tagClassMatch = trimmedSelector.match(
        /^([a-zA-Z][\w-]*)\.([a-zA-Z][\w-]*)$/,
    );
    if (tagClassMatch) {
        const [, tag, className] = tagClassMatch;
        const nodeClasses = node.attributes?.class?.split(/\s+/) || [];
        return (
            normalizeNodeName(node.nodeName, false) === tag.toUpperCase() &&
            nodeClasses.includes(className)
        );
    }

    // Tag with ID (e.g., "div#myId")
    const tagIdMatch = trimmedSelector.match(
        /^([a-zA-Z][\w-]*)#([a-zA-Z][\w-]*)$/,
    );
    if (tagIdMatch) {
        const [, tag, id] = tagIdMatch;
        return (
            normalizeNodeName(node.nodeName, false) === tag.toUpperCase() &&
            node.attributes?.id === id
        );
    }

    return false;
};

const matchesSelector = (node: VirtualNode, selector: string): boolean => {
    if (!selector) return false;

    // Handle multiple selectors separated by comma
    const selectors = selector.split(',').map((s) => s.trim());
    return selectors.some((sel) => matchesSimpleSelector(node, sel));
};

const shouldSkipElement = (
    node: VirtualNode,
    domNode: Node | null,
    options: DiffOptions,
): SkipMode | false => {
    if (node.nodeType !== NODE_TYPES.ELEMENT) return false;

    // Check CSS selector - try DOM API first, fall back to virtual matching
    if (options.skipSelector) {
        let matches = false;

        // Try browser DOM API if available
        if (
            domNode &&
            'matches' in domNode &&
            typeof (domNode as Element).matches === 'function'
        ) {
            matches = (domNode as Element).matches(options.skipSelector);
        } else {
            // Fall back to virtual node matching for Node.js
            matches = matchesSelector(node, options.skipSelector);
        }

        if (matches) {
            return options.skipMode || SKIP_MODES.CHILDREN;
        }
    }

    // Check custom predicate - pass both domNode and virtual node
    if (options.skipPredicate) {
        const result = options.skipPredicate(
            (domNode as Node) || (node as unknown as Node),
            node,
        );
        if (result === true) {
            return options.skipMode || SKIP_MODES.CHILDREN;
        }
        if (result === SKIP_MODES.CHILDREN || result === SKIP_MODES.FULL) {
            return result;
        }
    }

    return false;
};

const applySkipMode = (node: VirtualNode, skipMode: SkipMode): void => {
    if (skipMode === SKIP_MODES.CHILDREN) {
        node.innerDone = true;
    } else if (skipMode === SKIP_MODES.FULL) {
        node.skipFull = true;
    }
};

const diffAttributes = (
    oldAttrs: Record<string, string> | undefined,
    newAttrs: Record<string, string> | undefined,
    route: number[],
    options: DiffOptions,
): DiffResult[] => {
    const diffs: DiffResult[] = [];
    const allKeys = new Set([
        ...Object.keys(oldAttrs || {}),
        ...Object.keys(newAttrs || {}),
    ]);

    for (const key of allKeys) {
        if (options.skipAttributes.includes(key)) continue;

        const oldVal = oldAttrs?.[key];
        const newVal = newAttrs?.[key];

        if (oldVal === undefined && newVal !== undefined) {
            diffs.push({
                action: ACTIONS.ADD_ATTRIBUTE,
                route: cloneRoute(route),
                name: key,
                value: newVal,
            });
        } else if (oldVal !== undefined && newVal === undefined) {
            diffs.push({
                action: ACTIONS.REMOVE_ATTRIBUTE,
                route: cloneRoute(route),
                name: key,
                value: oldVal,
            });
        } else if (oldVal !== newVal) {
            diffs.push({
                action: ACTIONS.MODIFY_ATTRIBUTE,
                route: cloneRoute(route),
                name: key,
                oldValue: oldVal,
                newValue: newVal,
            });
        }
    }

    return diffs;
};

const findBestMatch = (
    oldChild: VirtualNode,
    newChildren: VirtualNode[],
    startIndex: number,
    options: DiffOptions,
): { index: number; score: number; keyMatch: boolean } | null => {
    let bestIndex = -1;
    let bestScore = 0;

    const oldKey = getElementKey(oldChild);

    for (let i = startIndex; i < newChildren.length; i++) {
        const newChild = newChildren[i];

        // Check for key match
        if (oldKey && oldKey === getElementKey(newChild)) {
            return { index: i, score: 1, keyMatch: true };
        }

        // Calculate similarity
        const score = calculateSimilarity(oldChild, newChild, options);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    return bestScore > 0.5
        ? { index: bestIndex, score: bestScore, keyMatch: false }
        : null;
};

const diffChildren = (
    oldChildrenP: VirtualNode[] | undefined,
    newChildrenP: VirtualNode[] | undefined,
    route: number[],
    options: DiffOptions,
    diffCount: { value: number },
): DiffResult[] => {
    let oldChildren = oldChildrenP;
    let newChildren = newChildrenP;
    if (!oldChildren) oldChildren = [];
    if (!newChildren) newChildren = [];

    const diffs: DiffResult[] = [];
    const oldUsed = new Set();
    const newUsed = new Set();
    const matches = [];

    // First pass: find matches
    for (let i = 0; i < oldChildren.length; i++) {
        const oldChild = oldChildren[i];

        // Try exact position match first
        if (i < newChildren.length && !newUsed.has(i)) {
            if (elementsMatch(oldChild, newChildren[i], options)) {
                const similarity = calculateSimilarity(
                    oldChild,
                    newChildren[i],
                    options,
                );
                if (similarity > 0.7) {
                    matches.push({
                        oldIndex: i,
                        newIndex: i,
                        score: similarity,
                    });
                    oldUsed.add(i);
                    newUsed.add(i);
                    continue;
                }
            }
        }

        // Find best match in remaining new children
        const match = findBestMatch(oldChild, newChildren, 0, options);
        if (match && !newUsed.has(match.index)) {
            matches.push({
                oldIndex: i,
                newIndex: match.index,
                score: match.score,
            });
            oldUsed.add(i);
            newUsed.add(match.index);
        }
    }

    // Sort matches by old index to process in order
    matches.sort((a, b) => a.oldIndex - b.oldIndex);

    // Second pass: detect relocations and recurse on matches
    for (const match of matches) {
        const oldChild = oldChildren[match.oldIndex];
        const newChild = newChildren[match.newIndex];

        // Check if relocation is needed
        if (match.oldIndex !== match.newIndex) {
            diffs.push({
                action: ACTIONS.RELOCATE_ELEMENT,
                from: [...route, match.oldIndex],
                to: [...route, match.newIndex],
                route: cloneRoute(route),
            });

            if (options.debug && diffs.length >= diffCount.value) {
                continue;
            }
        }

        // Recurse on matched elements
        const childRoute = [...route, match.oldIndex];
        const childDiffs = diffNode(
            oldChild,
            newChild,
            childRoute,
            options,
            diffCount,
        );
        diffs.push(...childDiffs);
    }

    // Third pass: handle removes (old children not matched)
    for (let i = oldChildren.length - 1; i >= 0; i--) {
        if (!oldUsed.has(i)) {
            diffs.push({
                action: ACTIONS.REMOVE_ELEMENT,
                route: [...route, i],
                element: oldChildren[i],
            });

            if (options.debug && diffs.length >= diffCount.value) {
                return diffs;
            }
        }
    }

    // Fourth pass: handle adds (new children not matched)
    for (let i = 0; i < newChildren.length; i++) {
        if (!newUsed.has(i)) {
            diffs.push({
                action: ACTIONS.ADD_ELEMENT,
                route: cloneRoute(route),
                element: newChildren[i],
                index: i,
            });

            if (options.debug && diffs.length >= diffCount.value) {
                return diffs;
            }
        }
    }

    return diffs;
};

const diffNode = (
    oldNode: VirtualNode,
    newNode: VirtualNode,
    route: number[],
    options: DiffOptions,
    diffCount: { value: number },
): DiffResult[] => {
    const diffs: DiffResult[] = [];

    // Check if we've hit the diff cap
    if (options.debug && diffCount.value >= options.diffcap) {
        return diffs;
    }

    // Skip if marked as full skip
    if (oldNode.skipFull || newNode.skipFull) {
        return diffs;
    }

    // Different node types or names - replace entire node
    if (!elementsMatch(oldNode, newNode, options)) {
        diffs.push({
            action: ACTIONS.REPLACE_ELEMENT,
            route: cloneRoute(route),
            oldValue: oldNode,
            newValue: newNode,
        });
        diffCount.value += diffs.length;
        return diffs;
    }

    // Text nodes
    if (oldNode.nodeType === NODE_TYPES.TEXT) {
        if (oldNode.data !== newNode.data) {
            diffs.push({
                action: ACTIONS.MODIFY_TEXT,
                route: cloneRoute(route),
                oldValue: oldNode.data,
                newValue: newNode.data,
            });
        }
        diffCount.value += diffs.length;
        return diffs;
    }

    // Comment nodes
    if (oldNode.nodeType === NODE_TYPES.COMMENT) {
        if (oldNode.data !== newNode.data) {
            diffs.push({
                action: ACTIONS.MODIFY_TEXT,
                route: cloneRoute(route),
                oldValue: oldNode.data,
                newValue: newNode.data,
            });
        }
        diffCount.value += diffs.length;
        return diffs;
    }

    // Element nodes
    if (oldNode.nodeType === NODE_TYPES.ELEMENT) {
        // Diff attributes
        const attrDiffs = diffAttributes(
            oldNode.attributes,
            newNode.attributes,
            route,
            options,
        );
        diffs.push(...attrDiffs);

        // Diff form values
        if (options.valueDiffing) {
            if (
                oldNode.value !== newNode.value &&
                newNode.value !== undefined
            ) {
                diffs.push({
                    action: ACTIONS.MODIFY_VALUE,
                    route: cloneRoute(route),
                    oldValue: oldNode.value,
                    newValue: newNode.value,
                });
            }
            if (
                oldNode.checked !== newNode.checked &&
                newNode.checked !== undefined
            ) {
                diffs.push({
                    action: ACTIONS.MODIFY_CHECKED,
                    route: cloneRoute(route),
                    oldValue: oldNode.checked,
                    newValue: newNode.checked,
                });
            }
            if (
                oldNode.selected !== newNode.selected &&
                newNode.selected !== undefined
            ) {
                diffs.push({
                    action: ACTIONS.MODIFY_SELECTED,
                    route: cloneRoute(route),
                    oldValue: oldNode.selected,
                    newValue: newNode.selected,
                });
            }
        }

        diffCount.value += diffs.length;

        if (options.debug && diffCount.value >= options.diffcap) {
            return diffs;
        }

        // Check if we should skip children
        if (oldNode.innerDone || newNode.innerDone || options.skipChildren) {
            return diffs;
        }

        // Diff children
        const childDiffs = diffChildren(
            oldNode.childNodes,
            newNode.childNodes,
            route,
            options,
            diffCount,
        );
        diffs.push(...childDiffs);
    }

    diffCount.value += diffs.length;
    return diffs;
};

export const diff = (
    elementA: string | Node | VirtualNode,
    elementB: string | Node | VirtualNode,
    options: Partial<DiffOptions> = {},
): DiffResult[] => {
    const mergedOptions: DiffOptions = { ...DEFAULT_OPTIONS, ...options };
    let objA: VirtualNode;
    let objB: VirtualNode;

    if (typeof elementA === 'string') {
        objA = stringToObj(elementA, mergedOptions);
    } else if (
        'nodeType' in elementA &&
        typeof (elementA as Node).nodeType === 'number'
    ) {
        objA = nodeToObj(elementA as Node, mergedOptions)!;
    } else {
        objA = elementA as VirtualNode;
    }

    if (typeof elementB === 'string') {
        objB = stringToObj(elementB, mergedOptions);
    } else if (
        'nodeType' in elementB &&
        typeof (elementB as Node).nodeType === 'number'
    ) {
        objB = nodeToObj(elementB as Node, mergedOptions)!;
    } else {
        objB = elementB as VirtualNode;
    }

    // Apply skip logic to both trees
    const applySkipLogic = (node: VirtualNode, domNode: Node | null): void => {
        if (node.nodeType === NODE_TYPES.ELEMENT) {
            const skipMode = shouldSkipElement(node, domNode, mergedOptions);
            if (skipMode) {
                applySkipMode(node, skipMode);
            }

            // Recurse on children
            if (node.childNodes && !node.skipFull) {
                node.childNodes.forEach((child, i) => {
                    const childDom = domNode?.childNodes?.[i];
                    applySkipLogic(child, childDom || null);
                });
            }
        } else if (node.nodeType === NODE_TYPES.COMMENT) {
            applySkipMode(node, SKIP_MODES.FULL);
        }
    };

    // Get domNode reference if available (for browser DOM nodes)
    const domNodeA =
        typeof elementA === 'object' &&
        'nodeType' in elementA &&
        typeof (elementA as Node).nodeType === 'number'
            ? (elementA as Node)
            : null;
    const domNodeB =
        typeof elementB === 'object' &&
        'nodeType' in elementB &&
        typeof (elementB as Node).nodeType === 'number'
            ? (elementB as Node)
            : null;

    applySkipLogic(objA, domNodeA);
    applySkipLogic(objB, domNodeB);

    // Quick check: if both marked as skipFull, return empty
    if (objA.skipFull && objB.skipFull) {
        return [];
    }

    // Perform diff
    const diffCount = { value: 0 };
    let diffs = diffNode(objA, objB, [], mergedOptions, diffCount);

    // Apply filterOuterDiff hook
    if (mergedOptions.filterOuterDiff) {
        diffs = mergedOptions.filterOuterDiff(objA, objB, diffs) || diffs;
    }

    return diffs;
};

const applyDiff = (
    element: Node,
    diff: DiffResult,
    options: DiffOptions,
): boolean => {
    try {
        // Call preDiffApply hook
        if (options.preDiffApply) {
            const skip = options.preDiffApply({ diff, node: element });
            if (skip === true) return true;
        }

        const target = getNodeByRoute(element, diff.route);
        if (!target && diff.action !== ACTIONS.ADD_ELEMENT) {
            return false;
        }

        switch (diff.action) {
            case ACTIONS.ADD_ELEMENT: {
                const parent =
                    diff.route.length === 0
                        ? element
                        : getNodeByRoute(element, diff.route);
                if (!parent || !diff.element) return false;

                const newNode = objToNode(diff.element, options);
                if (!newNode) return false;
                if (
                    diff.index !== undefined &&
                    diff.index < parent.childNodes.length
                ) {
                    parent.insertBefore(newNode, parent.childNodes[diff.index]);
                } else {
                    parent.appendChild(newNode);
                }
                break;
            }

            case ACTIONS.REMOVE_ELEMENT: {
                if (!target) return false;
                if (target.parentNode) {
                    target.parentNode.removeChild(target);
                }
                break;
            }

            case ACTIONS.RELOCATE_ELEMENT: {
                if (!diff.from || !diff.to) return false;
                const fromNode = getNodeByRoute(element, diff.from);
                const toParent =
                    diff.to.length === 1
                        ? element
                        : getNodeByRoute(element, diff.to.slice(0, -1));
                if (!fromNode || !toParent) return false;

                const toIndex = diff.to[diff.to.length - 1];
                if (toIndex < toParent.childNodes.length) {
                    toParent.insertBefore(
                        fromNode,
                        toParent.childNodes[toIndex],
                    );
                } else {
                    toParent.appendChild(fromNode);
                }
                break;
            }

            case ACTIONS.MODIFY_TEXT: {
                if (!target) return false;
                if (
                    target.nodeType === NODE_TYPES.TEXT ||
                    target.nodeType === NODE_TYPES.COMMENT
                ) {
                    const textNode = target as Text | Comment;
                    if (
                        options.textDiff &&
                        typeof diff.oldValue === 'string' &&
                        typeof diff.newValue === 'string'
                    ) {
                        options.textDiff(
                            target,
                            textNode.data,
                            diff.oldValue,
                            diff.newValue,
                        );
                    } else if (typeof diff.newValue === 'string') {
                        textNode.data = diff.newValue;
                    }
                }
                break;
            }

            case ACTIONS.REPLACE_ELEMENT: {
                if (!target || typeof diff.newValue !== 'object') return false;
                const newNode = objToNode(
                    diff.newValue as VirtualNode,
                    options,
                );
                if (!newNode) return false;
                if (target.parentNode) {
                    target.parentNode.replaceChild(newNode, target);
                }
                break;
            }

            case ACTIONS.ADD_ATTRIBUTE: {
                if (!target || !diff.name || typeof diff.value !== 'string')
                    return false;
                if (target.nodeType === NODE_TYPES.ELEMENT) {
                    (target as Element).setAttribute(diff.name, diff.value);
                }
                break;
            }

            case ACTIONS.REMOVE_ATTRIBUTE: {
                if (!target || !diff.name) return false;
                if (target.nodeType === NODE_TYPES.ELEMENT) {
                    (target as Element).removeAttribute(diff.name);
                }
                break;
            }

            case ACTIONS.MODIFY_ATTRIBUTE: {
                if (!target || !diff.name || typeof diff.newValue !== 'string')
                    return false;
                if (target.nodeType === NODE_TYPES.ELEMENT) {
                    (target as Element).setAttribute(diff.name, diff.newValue);
                }
                break;
            }

            case ACTIONS.MODIFY_VALUE: {
                if (!target || typeof diff.newValue !== 'string') return false;
                (target as HTMLInputElement).value = diff.newValue;
                break;
            }

            case ACTIONS.MODIFY_CHECKED: {
                if (!target || typeof diff.newValue !== 'boolean') return false;
                (target as HTMLInputElement).checked = diff.newValue;
                break;
            }

            case ACTIONS.MODIFY_SELECTED: {
                if (!target || typeof diff.newValue !== 'boolean') return false;
                (target as HTMLOptionElement).selected = diff.newValue;
                break;
            }

            default:
                return false;
        }

        // Call postDiffApply hook
        if (options.postDiffApply) {
            options.postDiffApply({ diff, node: element });
        }

        return true;
    } catch (error) {
        if (options.debug) {
            console.error('Error applying diff:', error, diff);
        }
        return false;
    }
};

export const apply = (
    element: Node,
    diffs: DiffResult[],
    options: Partial<DiffOptions> = {},
): boolean => {
    const mergedOptions: DiffOptions = { ...DEFAULT_OPTIONS, ...options };
    if (!Array.isArray(diffs)) {
        return false;
    }

    for (const diff of diffs) {
        const success = applyDiff(element, diff, mergedOptions);
        if (!success) {
            return false;
        }
    }

    return true;
};

const invertDiff = (diff: DiffResult): DiffResult => {
    const inverted: DiffResult = { ...diff };

    switch (diff.action) {
        case ACTIONS.ADD_ELEMENT:
            inverted.action = ACTIONS.REMOVE_ELEMENT;
            break;

        case ACTIONS.REMOVE_ELEMENT:
            inverted.action = ACTIONS.ADD_ELEMENT;
            inverted.index = diff.route[diff.route.length - 1];
            break;

        case ACTIONS.RELOCATE_ELEMENT:
            inverted.from = diff.to;
            inverted.to = diff.from;
            break;

        case ACTIONS.MODIFY_TEXT:
            inverted.oldValue = diff.newValue;
            inverted.newValue = diff.oldValue;
            break;

        case ACTIONS.REPLACE_ELEMENT:
            inverted.oldValue = diff.newValue;
            inverted.newValue = diff.oldValue;
            break;

        case ACTIONS.ADD_ATTRIBUTE:
            inverted.action = ACTIONS.REMOVE_ATTRIBUTE;
            break;

        case ACTIONS.REMOVE_ATTRIBUTE:
            inverted.action = ACTIONS.ADD_ATTRIBUTE;
            break;

        case ACTIONS.MODIFY_ATTRIBUTE:
            inverted.oldValue = diff.newValue;
            inverted.newValue = diff.oldValue;
            break;

        case ACTIONS.MODIFY_VALUE:
        case ACTIONS.MODIFY_CHECKED:
        case ACTIONS.MODIFY_SELECTED:
            inverted.oldValue = diff.newValue;
            inverted.newValue = diff.oldValue;
            break;
    }

    return inverted;
};

export const undo = (
    element: Node,
    diffs: DiffResult[],
    options: Partial<DiffOptions> = {},
): boolean => {
    if (!Array.isArray(diffs)) {
        return false;
    }

    const reversedDiffs = [...diffs].reverse();
    const invertedDiffs = reversedDiffs.map((diff) => invertDiff(diff));

    return apply(element, invertedDiffs, options);
};

export const createDiffDOM = (userOptions: Partial<DiffOptions> = {}) => {
    const options: DiffOptions = { ...DEFAULT_OPTIONS, ...userOptions };

    return {
        diff: (
            elementA: string | Node | VirtualNode,
            elementB: string | Node | VirtualNode,
        ) => diff(elementA, elementB, options),
        apply: (element: Node, diffs: DiffResult[]) =>
            apply(element, diffs, options),
        undo: (element: Node, diffs: DiffResult[]) =>
            undo(element, diffs, options),
    };
};

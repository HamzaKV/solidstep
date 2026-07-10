import { escapeHtml } from './escape.js';

/**
 * Development-only error overlay. Callers gate every use behind
 * `import.meta.env.DEV` so this module is tree-shaken from production bundles.
 *
 * - `renderDevOverlayDocument` builds a full HTML page for an unhandled SSR
 *   error (replacing the bare 500 in dev).
 * - `devOverlayClientScript` is an inline `<script>` injected into every dev
 *   page; it registers `window.onerror`/`unhandledrejection` handlers and a
 *   `window.__solidstepDevOverlay(err)` mounter so client hydration/navigation
 *   and server-action errors surface the same overlay.
 */

const OVERLAY_CSS = `
.ss-devoverlay{position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,14,.85);
color:#e6e6e6;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
padding:24px;overflow:auto;backdrop-filter:blur(2px)}
.ss-devoverlay .ss-box{max-width:920px;margin:24px auto;background:#16161c;border:1px solid #33333d;
border-radius:8px;padding:20px 24px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.ss-devoverlay .ss-tag{display:inline-block;background:#7f1d1d;color:#fecaca;border-radius:4px;
padding:2px 8px;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
.ss-devoverlay .ss-msg{color:#ff8a8a;font-size:16px;font-weight:600;margin:12px 0;white-space:pre-wrap;word-break:break-word}
.ss-devoverlay .ss-req{color:#9aa;margin:0 0 12px}
.ss-devoverlay .ss-stack{white-space:pre-wrap;word-break:break-word;color:#c8c8d0;
background:#0e0e12;border:1px solid #2a2a32;border-radius:6px;padding:12px;margin:0}
.ss-devoverlay .ss-close{float:right;background:#2a2a32;color:#e6e6e6;border:1px solid #44444f;
border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
`.trim();

const toError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

/** Build a full HTML document showing an unhandled SSR error (dev only). */
export const renderDevOverlayDocument = (
    error: unknown,
    ctx: { method?: string; url?: string } = {},
): string => {
    const err = toError(error);
    // `.name`/`.message`/`.stack` are typed `string` but not enforced at
    // runtime -- an Error subclass can reassign them to anything.
    const name = escapeHtml(String(err.name || 'Error'));
    const message = escapeHtml(String(err.message || ''));
    const stack = escapeHtml(String(err.stack || ''));
    const req = escapeHtml(`${ctx.method ?? ''} ${ctx.url ?? ''}`.trim());
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name} — SolidStep (dev)</title><style>${OVERLAY_CSS}</style></head><body><div class="ss-devoverlay"><div class="ss-box"><span class="ss-tag">Unhandled server error · dev</span><div class="ss-msg">${message}</div>${req ? `<div class="ss-req">${req}</div>` : ''}<pre class="ss-stack">${stack}</pre></div></div></body></html>`;
};

/**
 * Inline `<script>` (dev only) that mounts the overlay for client-side errors.
 * Injected into every dev page so uncaught errors, rejected promises, and
 * server-action failures show the overlay.
 */
export const devOverlayClientScript = (nonce?: string): string => {
    const js = `(function(){
if(window.__solidstepDevOverlay)return;
var css=${JSON.stringify(OVERLAY_CSS)};
function mount(err){
try{
var prev=document.getElementById('solidstep-devoverlay');if(prev)prev.remove();
var root=document.createElement('div');root.id='solidstep-devoverlay';root.className='ss-devoverlay';
var st=document.createElement('style');st.textContent=css;root.appendChild(st);
var box=document.createElement('div');box.className='ss-box';
var close=document.createElement('button');close.className='ss-close';close.textContent='Dismiss';close.onclick=function(){root.remove();};box.appendChild(close);
var tag=document.createElement('span');tag.className='ss-tag';tag.textContent='Unhandled client error · dev';box.appendChild(tag);
var msg=document.createElement('div');msg.className='ss-msg';msg.textContent=(err&&err.message)||String(err);box.appendChild(msg);
var stack=document.createElement('pre');stack.className='ss-stack';stack.textContent=(err&&err.stack)||'';box.appendChild(stack);
root.appendChild(box);(document.body||document.documentElement).appendChild(root);
}catch(_){}
}
window.__solidstepDevOverlay=mount;
window.addEventListener('error',function(e){mount(e.error||e.message);});
window.addEventListener('unhandledrejection',function(e){mount(e.reason);});
})();`;
    return `<script ${nonce ? `nonce="${nonce}"` : ''}>${js}</script>`;
};

import { isServer } from 'solid-js/web';

if (!isServer) {
    throw new Error('This module is only available on the server side.');
}

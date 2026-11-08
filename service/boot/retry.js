import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';

const OK = 13;

// Not for the first seconds: the page is not stuck yet, and a press then would only start it over.
const TOO_SOON = 3000;

// The page on disk is read again, which is also how a rewritten one (a new address, a new port) is picked up.
// What a viewer who sees nothing happen can do from the remote, rather than a reboot or a reinstall.
const again = () => {
    if (held.handed || held.rereading || elapsed() < TOO_SOON) return;

    held.rereading = true;
    say('tube', 'reading this page again, as asked', 'note');

    setTimeout(() => {
        try {
            window.location.replace(String(window.location.href).split('#')[0]);
        } catch (e) {
            held.rereading = false;
            say('tube', `could not read the page again: ${e.message}`, 'warn');
        }
    }, 300);
};

export const armRetry = () => {
    document.addEventListener('keydown', (event) => {
        if (event.keyCode === OK) again();
    });
};

export const hintRetry = () => {
    if (held.hinted) return;
    held.hinted = true;

    say('tube', 'press OK on the remote to try again now', 'note');
};

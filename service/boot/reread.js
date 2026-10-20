import { TIMING } from './timing.js';
import { held } from './state.js';
import { elapsed } from './clock.js';
import { say } from './screen.js';

// This page names the address the service had when it wrote it. A set started before its network was
// up, or given a new lease since, leaves it asking an address nobody answers at, for ever: the service
// writes the page again for its new address, and reading it again here is what picks that up — rather
// than a reboot or a reinstall.
//
// Counted across reads, and only where the count can be kept: a page read again resets its own clock, so
// without the count a service that is truly gone would be read again for ever, and the screen would never
// reach the advice it gives after a minute. After TIMING.rereadTimes reads it waits as it always did.
const KEY = 'tube.reread';

// A count from a start long ago is not this start's: it counts from nothing again.
const FORGET_AFTER = 10 * 60 * 1000;

const storage = () => {
    try {
        const kept = window.localStorage;
        kept.setItem(`${KEY}.probe`, '1');
        kept.removeItem(`${KEY}.probe`);
        return kept;
    } catch (e) {
        return null;
    }
};

const counted = () => {
    const kept = storage();
    if (!kept) return null;

    const [count, at] = String(kept.getItem(KEY) || '').split(':').map(Number);
    return count && Date.now() - at < FORGET_AFTER ? count : 0;
};

const remember = (count) => {
    const kept = storage();
    if (!kept) return;

    if (count) kept.setItem(KEY, `${count}:${Date.now()}`);
    else kept.removeItem(KEY);
};

// Once the service answers, the next stuck start counts from nothing again.
export const answered = () => {
    if (counted()) remember(0);
};

export const rereadIfStuck = () => {
    if (held.seen || held.rereading || elapsed() < TIMING.rereadAfter) return;

    const before = counted();
    if (before === null || before >= TIMING.rereadTimes) return;

    held.rereading = true;

    const count = before + 1;
    remember(count);

    say('tube', `nothing has answered for ${Math.round(elapsed() / 1000)}s: reading this page again, in case the `
        + `TV's address changed${count > 1 ? ` (${count} times now)` : ''}`, 'note');

    setTimeout(() => {
        try {
            window.location.replace(String(window.location.href).split('#')[0]);
        } catch (e) {
            held.rereading = false;
            say('tube', `could not read the page again: ${e.message}`, 'warn');
        }
    }, TIMING.linger);
};
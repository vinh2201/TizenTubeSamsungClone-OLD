'use strict';

const postmortem = require('./postmortem.js');
const pin = require('./pin.js');
const { fromThisTv } = require('./clients.js');

// What the service writes about itself (the log, /diag, the facts about this set) is for the person looking after
// the TV. The set's own pages may read it freely; another device on the network needs the code that the boot
// screen shows on the TV, so that having the same Wi-Fi is not enough.

const COOKIE = 'tube_pin';
const MOST_WRONG = 10;
const WITHIN = 60 * 1000;
const LOCKED_FOR = 5 * 60 * 1000;

// Per device: one that keeps guessing is shut out without shutting out the person who has the code.
const MOST_DEVICES = 50;
const tries = {};

const triesOf = (address) => {
    if (!tries[address]) {
        const known = Object.keys(tries);
        if (known.length >= MOST_DEVICES) delete tries[known[0]];

        tries[address] = { wrong: [], lockedUntil: 0 };
    }

    return tries[address];
};

const cookieOf = (req) => {
    const found = /(?:^|;\s*)tube_pin=(\d{6})/.exec((req.headers && req.headers.cookie) || '');
    return found ? found[1] : '';
};

const offered = (req) => String((req.query && req.query.k) || cookieOf(req) || '');

const refuse = (res, status, text) => {
    res.status(status).type('text/plain').send(text);
    return false;
};

// True when the request may go on; otherwise the answer has been sent.
const allow = (req, res) => {
    if (fromThisTv(req)) return true;

    const now = Date.now();
    const device = triesOf(String((req.socket && req.socket.remoteAddress) || 'unknown'));
    if (now < device.lockedUntil) return refuse(res, 429, 'tube: too many wrong codes; try again in a few minutes');

    const given = offered(req);

    if (given && given === pin.current()) {
        if (!cookieOf(req)) res.setHeader('Set-Cookie', `${COOKIE}=${given}; Path=/; HttpOnly`);
        return true;
    }

    if (given) {
        device.wrong = device.wrong.filter((at) => now - at < WITHIN).concat([now]);

        if (device.wrong.length >= MOST_WRONG) {
            device.lockedUntil = now + LOCKED_FOR;
            device.wrong = [];
            postmortem.note('privacy', 'too many wrong codes for the diagnostics from one device; closed to it for a few minutes');
        }
    }

    return refuse(res, 403, 'tube: open the address the TV shows on its start-up screen; it carries the code');
};

module.exports = { allow, COOKIE };

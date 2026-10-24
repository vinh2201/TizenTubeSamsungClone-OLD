'use strict';


const postmortem = require('./lib/postmortem.js');
const lastRun = require('./lib/lastRun.js');
const printed = require('./lib/printed.js');

lastRun.recall();
postmortem.watch();
printed.attach();

const ports = require('./lib/ports.js');
const { USER_SCRIPT, sized } = require('./lib/shipped.js');
const proxy = require('./lib/proxy.js');
const { STAMP } = require('./lib/stamp.js');
const { capability } = require('./lib/platform.js');
const { lanAddresses } = require('./lib/serviceAddress.js');
const claimants = require('./lib/claimants.js');
const bootRoutes = require('./lib/bootRoutes.js');
const journalRoutes = require('./lib/journalRoutes.js');
const diagRoutes = require('./lib/diagRoutes.js');
const routeErrors = require('./lib/routeErrors.js');
const dev = require('./dev/index.js');
const upgrade = require('./lib/upgrade.js');
const knobs = require('./lib/knobs.js');

// A cobalt.js that will not load must not stop the proxy starting.
const cobalt = require('./lib/cobaltIfItLoads.js')();

const isTV = typeof tizen !== 'undefined';

const containerRoute = cobalt ? cobalt.container() : null;

const platformVersion = isTV
    ? tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version')
    : (process.env.TUBE_PLATFORM_VERSION || null);

postmortem.note('platform', `tizen ${platformVersion || 'none'}, node ${process.version}, `
    + `${capability('http://tizen.org/system/model_name') || 'unknown model'}, patch ${STAMP}`);

claimants.survey();

const app = proxy.create();

// Cobalt denies a document that arrives without a Content-Security-Policy, and which policies it
// accepts varies by version.
const POLICIES = {
    wide: [
        "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        'img-src * data: blob:',
        'media-src * data: blob:',
        "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
        "style-src * data: blob: 'unsafe-inline'",
        'connect-src *',
        'font-src * data:'
    ].join('; '),

    plain: "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'",

    none: null
};

const state = { policy: 'wide' };

app.use((_, res, next) => {
    const chosen = POLICIES[state.policy];

    if (chosen) res.setHeader('Content-Security-Policy', chosen);
    else res.removeHeader('Content-Security-Policy');

    next();
});

const userScript = () => sized(USER_SCRIPT);

app.get('/__tube/state', (_, res) => res.json({ script: userScript(), platformVersion, container: containerRoute }));

const retraceOnBoot = (line) => {
    if (line.indexOf('booted ') === 0) proxy.retrace();
};

journalRoutes.attach(app, { heard: retraceOnBoot });
bootRoutes.attach(app, { cobalt, script: userScript });
diagRoutes.attach(app);

// dev/ may not know about the container route, and on a set without one it is absent.
dev.routes(app, {
    policies: POLICIES,
    state,
    knobs,
    relaunch: cobalt ? cobalt.relaunch : null
});

dev.attach(app);
proxy.attachFallback(app);
routeErrors.attach(app);

// Every interface: the 5.5 widget's container reaches us on this set's own address, the 5.0 widget's on 127.0.0.2.
const BIND = '0.0.0.0';

// The address the 5.0 widget's --base_url names. Another app is far less likely to hold it than 127.0.0.1.
const LOOPBACK = '127.0.0.2';

const WATCH_EVERY = 5000;
const REPEAT_AFTER = 60000;

const repeated = { text: '', at: 0 };

// The same refusal every five seconds fills a 64KB log with itself and pushes out what explains it.
const noteRarely = (what, text) => {
    const now = Date.now();
    if (text === repeated.text && now - repeated.at < REPEAT_AFTER) return;

    repeated.text = text;
    repeated.at = now;
    postmortem.note(what, text);
};

// What is answering right now. Nothing here remembers an address for longer than the server on it lives.
const held = { wildcard: false, servers: {}, trying: {}, lan: '' };

const startServer = (address, done) => {
    const serving = { yes: false };

    const server = app.listen(ports.PROXY, address, () => {
        serving.yes = true;

        postmortem.note('listening', `${address}:${ports.PROXY}`);
        console.log(`tube service on ${address}:${ports.PROXY}`);
        if (!isTV) console.log('Running off-TV: proxy and userscript are live.');

        done(null, server);
    });

    // An upgrade is not a request express ever sees, and an unanswered one hangs rather than fails.
    upgrade.attach(server, { rewrite: dev.upgradeRewrite });

    // A later error once the port is ours would otherwise start a second server beside the one
    // already answering.
    server.on('error', (error) => {
        // Both widgets carry a service and install side by side.
        const why = error.code === 'EADDRINUSE'
            ? 'something already holds that port — the other Tube widget, or an older build of this '
                + 'one, is the usual cause; only one of the two can serve the container'
            : postmortem.describe(error);

        noteRarely('listen', `${address}:${ports.PROXY} — ${why}`);
        if (serving.yes) return undefined;

        return done(error);
    });
};

const unique = (address, index, all) => all.indexOf(address) === index;

// When something else holds the port on one address, the wildcard is refused but the addresses that matter
// are still free: 127.0.0.2 for the 5.0 widget, the LAN addresses for the 5.5 widget and for a phone. They
// are served one by one, and followed when DHCP moves the set.
const serveEach = () => {
    const wanted = [LOOPBACK].concat(lanAddresses()).filter(unique);

    wanted.forEach((address) => {
        if (held.servers[address] || held.trying[address]) return;

        held.trying[address] = true;

        startServer(address, (error, server) => {
            held.trying[address] = false;
            if (!error) held.servers[address] = server;
        });
    });

    Object.keys(held.servers).forEach((address) => {
        if (address === LOOPBACK || wanted.indexOf(address) !== -1) return;

        postmortem.note('listening', `${address}:${ports.PROXY} released: the set no longer has that address`);

        try {
            held.servers[address].close();
        } catch (e) {
            // Closing a server that is already gone changes nothing.
        }

        delete held.servers[address];
    });
};

const open = () => startServer(BIND, (error, server) => {
    if (!error) {
        held.wildcard = true;
        held.servers[BIND] = server;
        return undefined;
    }

    return serveEach();
});

// The boot screen carries the address it was written for, so a lease that changes while the service keeps
// running (no wake message comes with it) would send the next open to the old one.
const watchNetwork = () => setInterval(() => {
    const now = lanAddresses().join(',');

    if (now !== held.lan) {
        postmortem.note('network', `address of this set: ${now || 'none'} (was ${held.lan || 'none'})`);
        held.lan = now;

        // The boot screen follows the address too (cobalt.js polls it every 10 s); asking now saves the wait.
        const follow = cobalt && (cobalt.readdress || cobalt.refreshBootScreen);

        if (follow) {
            try {
                follow();
            } catch (e) {
                postmortem.note('cobalt', e);
            }
        }
    }

    // Retried for as long as nothing serves the wildcard: whatever held the port may have gone.
    if (!held.wildcard) serveEach();
}, WATCH_EVERY);

const holdFor = dev.startDelay();
if (holdFor) postmortem.note('listen', `held shut for ${holdFor / 1000}s by TUBE_START_DELAY`);

setTimeout(() => {
    held.lan = lanAddresses().join(',');
    open();
    watchNetwork();
}, holdFor);

// Tizen's service runner calls these on every wake message, and a missing one kills the service.
module.exports = {
    onStart: () => {},

    onRequest: () => {
    postmortem.note(
        'debug',
        `onRequest received at ${new Date().toISOString()}`
    );

    if (!cobalt) return;

    try {
        cobalt.wake();
    } catch (e) {
        postmortem.note('cobalt', e);
    }
},

    onStop: () => {}
};

// Staging a directory and issuing a certificate must not be able to stop the proxy answering.
if (cobalt) {
    try {
        cobalt.prepare();
    } catch (e) {
        postmortem.note('cobalt', `prepare threw: ${postmortem.describe(e)}`);
    }
}

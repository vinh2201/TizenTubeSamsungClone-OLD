'use strict';

// Who may use the service to reach the internet, and where it may take them.
//
// The service listens on every interface, because the container reaches it on this set's own
// address. Without a check, that also makes it a relay for every device on the network: any of
// them could have the set fetch any address, inside the home network included. Pages and files
// the service makes itself (the boot page, /diag for a phone) are not affected; only the routes
// that forward a request onward are.

const postmortem = require('./postmortem.js');
const { lanAddresses } = require('./serviceAddress.js');

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1)$/;

// Where the page itself sends through /cors-bypass/ (mods/network/originRewrite.js), plus YouTube:
// the hosts route.js already treats as Google's.
const { GOOGLE } = require('./route.js');

// Off a television, a developer may want a laptop browser or a test server let through too.
const listed = (name) => String(process.env[name] || '').split(',').map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const plain = (address) => String(address || '').replace(/^::ffff:/i, '');

const fromThisTv = (req) => {
    if (process.env.TUBE_PROXY_OPEN === '1') return true;

    const address = plain(req && req.socket && req.socket.remoteAddress);
    if (!address) return false;

    return LOOPBACK.test(address) || lanAddresses().indexOf(address) !== -1 || listed('TUBE_PROXY_CLIENTS').indexOf(address) !== -1;
};

const bypassAllows = (host) => {
    const name = String(host || '').split(':')[0].toLowerCase();
    if (!name) return false;

    return GOOGLE.test(name) || listed('TUBE_BYPASS_HOSTS').indexOf(name) !== -1;
};

// Noted once a minute per kind and address, so a scan of the set cannot fill the log.
const QUIET_FOR = 60000;
const KEPT = 64;
const noted = new Map();

const refused = (kind, address, detail) => {
    const key = `${kind} ${address}`;
    const now = Date.now();

    if (noted.has(key) && now - noted.get(key) < QUIET_FOR) return;

    noted.delete(key);
    noted.set(key, now);
    Array.from(noted.keys()).slice(0, Math.max(0, noted.size - KEPT)).forEach((oldest) => noted.delete(oldest));

    postmortem.note('refused', `${kind} from ${address || 'unknown'}${detail ? `: ${detail}` : ''}`);
};

module.exports = { fromThisTv, bypassAllows, refused, plain };
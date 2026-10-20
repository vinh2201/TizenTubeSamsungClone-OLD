'use strict';

// The boot screen names the set's address; when that changes, the screen is written again for the new one.

const fs = require('fs');
const os = require('os');
const path = require('path');

const content = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-readdress-'));
process.env.TUBE_COBALT_CONTENT = content;
process.env.TUBE_LOG = path.join(content, 'service.log');

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

// The set's interfaces, as the test says they are; the address cache is stepped past by moving the clock.
const network = { addresses: [] };
os.networkInterfaces = () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: network.addresses.map((address) => ({ address, family: 'IPv4', internal: false }))
});
const realNow = Date.now;
const clock = { offset: 0 };
Date.now = () => realNow() + clock.offset;
const later = () => { clock.offset += 6000; };

const cobalt = require('../lib/cobalt.js');
const postmortem = require('../lib/postmortem.js');

const page = () => fs.readFileSync(path.join(content, 'web', 'tube', 'boot.html'), 'utf8');
const names = (address) => page().indexOf(`"service":"http://${address}:8099"`) !== -1;
const moves = () => postmortem.since(0).lines.filter((line) => line.what === 'cobalt' && /^address:/.test(line.text));

// Started before the network was up: loopback is all there is, and the container cannot reach it.
cobalt.refreshBootScreen();
check('written before the network is up, the screen can only name loopback', names('127.0.0.1'), page().slice(0, 200));

network.addresses = ['192.0.2.40'];
later();
cobalt.readdress();
check('once the TV has an address, the screen is written again for it', names('192.0.2.40'), page().slice(0, 300));

later();
const before = fs.statSync(path.join(content, 'web', 'tube', 'boot.html')).mtimeMs;
cobalt.readdress();
check('an unchanged address writes nothing', fs.statSync(path.join(content, 'web', 'tube', 'boot.html')).mtimeMs === before
    && moves().length === 1, moves().map((line) => line.text).join(' | '));

network.addresses = ['192.0.2.77'];
later();
cobalt.readdress();
check('a new lease is followed too, and noted for the diagnostics', names('192.0.2.77')
    && /192\.0\.2\.40 → 192\.0\.2\.77/.test(moves().map((line) => line.text).join(' | ')), moves().map((line) => line.text).join(' | '));

Date.now = realNow;
fs.rmSync(content, { recursive: true, force: true });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
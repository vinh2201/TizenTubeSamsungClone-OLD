'use strict';

// A service that cannot keep its port, or whose address changed, must not leave the viewer with a reinstall as the
// only way out: the port may move to a spare one, the boot screen is written again for wherever the service is,
// and it knows other places to look.

const fs = require('fs');
const os = require('os');
const path = require('path');

const content = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-selfheal-'));
process.env.TUBE_COBALT_CONTENT = content;
process.env.TUBE_LOG = path.join(content, 'service.log');

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const network = { addresses: ['192.0.2.40'] };
os.networkInterfaces = () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: network.addresses.map((address) => ({ address, family: 'IPv4', internal: false }))
});
const realNow = Date.now;
const clock = { offset: 0 };
Date.now = () => realNow() + clock.offset;

const ports = require('../lib/ports.js');
const portMemory = require('../lib/portMemory.js');
const cobalt = require('../lib/cobalt.js');
const postmortem = require('../lib/postmortem.js');

const page = () => fs.readFileSync(path.join(content, 'web', 'tube', 'boot.html'), 'utf8');
const alternatesOf = () => JSON.parse(/"alternates":(\[[^\]]*\])/.exec(page())[1]);
const policy = () => /h5vcc-location-src ([^"]*)"/.exec(page())[1];
const notes = () => postmortem.since(0).lines.filter((line) => line.what === 'cobalt' && /^address:/.test(line.text)).map((line) => line.text);

// ------------------------------------------------------------------ the port
check('the port in use starts as the one config.xml knows', ports.current() === ports.PROXY, ports.current());
check('spare ports are high and distinct from it', ports.SPARE.length >= 2 && ports.SPARE.every((port) => port > 10000 && port !== ports.PROXY), ports.SPARE.join());

ports.use(ports.SPARE[0]);
check('the port in use can move, and is listed first', ports.current() === ports.SPARE[0] && ports.all()[0] === ports.SPARE[0], ports.all().join());
check('every other port is still listed, the first one included', ports.all().indexOf(ports.PROXY) !== -1 && ports.all().length === 1 + ports.SPARE.length, ports.all().join());
ports.use(ports.PROXY);

// ------------------------------------------------------------------ what is remembered
check('nothing is remembered on a first start', portMemory.recall() === null, portMemory.recall());

portMemory.remember(ports.SPARE[1]);
check('a spare port that was used is remembered', portMemory.recall() === ports.SPARE[1], portMemory.recall());

fs.writeFileSync(portMemory.FILE, '22');
check('a port that is none of ours is not believed', portMemory.recall() === null, portMemory.recall());

fs.writeFileSync(portMemory.FILE, 'not a number');
check('nor is text', portMemory.recall() === null, portMemory.recall());

// ------------------------------------------------------------------ the boot screen follows the port
check('the 5.5 widget is the one that has a boot screen', cobalt.usesBootScreen() === true, cobalt.usesBootScreen());

cobalt.refreshBootScreen();
check('the screen names the port in use', page().indexOf(`"service":"http://192.0.2.40:${ports.PROXY}"`) !== -1, page().slice(0, 300));

ports.use(ports.SPARE[0]);
clock.offset += 6000;
cobalt.readdress();
check('when the port moves the screen is written again for it', page().indexOf(`"service":"http://192.0.2.40:${ports.SPARE[0]}"`) !== -1, page().slice(0, 300));
check('and the move is noted', notes().some((text) => new RegExp(`port ${ports.PROXY} → ${ports.SPARE[0]}`).test(text)), notes().join(' | '));

cobalt.readdress();
check('an unchanged port writes nothing', notes().filter((text) => /^address: port/.test(text)).length === 1, notes().join(' | '));

// ------------------------------------------------------------------ where else the screen looks
const alternates = alternatesOf();
check('the address the 5.0 widget uses is tried', alternates.indexOf(`http://127.0.0.2:${ports.SPARE[0]}`) !== -1, alternates.join());
check('the first port is tried too, in case the service went back to it', alternates.indexOf(`http://192.0.2.40:${ports.PROXY}`) !== -1, alternates.join());
check('every port is tried on the address chosen', ports.all().every((port) => port === ports.SPARE[0] || alternates.indexOf(`http://192.0.2.40:${port}`) !== -1), alternates.join());
check('the screen is allowed to go wherever one of them answers', alternates.every((origin) => policy().indexOf(origin) !== -1), policy());
check('without listing the same place twice', alternates.length === new Set(alternates).size, alternates.join());

network.addresses = ['192.0.2.77'];
clock.offset += 6000;
cobalt.readdress();
check('a new address is looked for as well as followed', page().indexOf('"service":"http://192.0.2.77:') !== -1 && alternatesOf().indexOf(`http://127.0.0.2:${ports.SPARE[0]}`) !== -1, page().slice(0, 300));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);

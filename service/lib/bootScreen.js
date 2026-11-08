'use strict';

const fs = require('fs');
const path = require('path');

const ports = require('./ports.js');
const pin = require('./pin.js');
const { lanAddresses, serviceAddress } = require('./serviceAddress.js');
const { SCREEN } = require('./pageLines.js');
const { STAMP } = require('./stamp.js');
const { DISCORD, REPO } = require('./links.js');
const { BOOT_PAGE, read } = require('./shipped.js');

const BOOT_URL = 'file:///tube/boot.html';

// file:// resolves against <content>/web.
const RELATIVE = path.join('web', 'tube', 'boot.html');

const YOUTUBE = 'https://www.youtube.com';

const origin = (address, port) => `http://${address}:${port || ports.current()}`;

const unique = (value, index, all) => all.indexOf(value) === index;

// Tried when the chosen address does not answer, to tell a blocked address from a dead service. 127.0.0.2 is
// where the 5.0 widget reaches us, and the rest of 127.x is open to other apps on a TV. The service may also
// have moved to a spare port (index.js) since this page was written, so the other ports are asked on the
// address chosen and on 127.0.0.2.
const alternates = () => {
    const chosen = serviceAddress();

    const addresses = ['127.0.0.2', '127.0.0.1'].concat(lanAddresses()).filter(unique)
        .filter((address) => address !== chosen);

    const otherPorts = ports.all().slice(1).reduce((all, port) => all
        .concat([chosen, '127.0.0.2'].filter(unique).map((address) => origin(address, port))), []);

    return addresses.map((address) => origin(address)).concat(otherPorts).filter(unique);
};

const HELP = { discord: DISCORD, repo: REPO };

// The viewer reads these on a phone, where loopback is useless.
const onTheLan = (route) => `http://${lanAddresses()[0] || '127.0.0.1'}:${ports.current()}${route}`;

const configFor = () => ({
    service: origin(serviceAddress()),
    alternates: alternates(),
    // Served by us rather than fetched from YouTube: there is no proxy to intercept the real host.
    target: `${origin(serviceAddress())}/tv`,
    probeUrl: `${origin(serviceAddress())}/__tube/ping`,
    screen: SCREEN,
    journal: onTheLan('/__tube/log'),
    diag: `${onTheLan('/diag')}?k=${pin.current()}`,
    help: HELP,
    written: { at: Date.now(), patch: STAMP, pid: process.pid }
});

// Cobalt refuses whatever the policy omits, navigation included.
const policyFor = (config) => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; `
    + `connect-src ${[config.service].concat(config.alternates).join(' ')} ${YOUTUBE}; `
    // The boot screen hands over to whichever address answered (see boot/elsewhere.js), so those are allowed too.
    + `h5vcc-location-src ${[YOUTUBE, config.service].concat(config.alternates).join(' ')} file:`;

const STYLE = `html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background-color: #000000; }
body { color: #aaaaaa; font-family: monospace; font-size: 19px; line-height: 29px; }
#log { position: absolute; left: 24px; right: 24px; top: 16px; white-space: pre; }
.t { color: #00aa00; }
.s { color: #aa5500; }
.ok { color: #55ff55; }
.warn { color: #ffff55; }
.bad { color: #ff5555; }
.note { color: #55ffff; }`;

const page = (script, config) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policyFor(config)}">
<title>YouTube</title>
<style>
${STYLE}
</style>
</head>
<body>
<div id="log"></div>
<script>window.TUBE_BOOT = ${JSON.stringify(config)};</script>
<script>
${script}
</script>
</body>
</html>
`;

const html = (script) => page(script, configFor());

// Renamed into place, so a container starting meanwhile never reads half a page.
const writeBootScreen = (content, script) => {
    const file = path.join(content, RELATIVE);
    const staged = `${file}.${process.pid}`;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(staged, html(script || read(BOOT_PAGE)));
    fs.renameSync(staged, file);

    return file;
};

module.exports = { BOOT_URL, html, writeBootScreen };

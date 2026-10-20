'use strict';

// The service listens on every interface. What forwards a request onward must serve this set alone,
// and only to the hosts the page sends through it.

const http = require('http');
const net = require('net');
const os = require('os');

process.env.TUBE_PROXY_HOST = 'tv.example';
process.env.TUBE_LOG = require('path').join(os.tmpdir(), `tube-exposure-${process.pid}.log`);
delete process.env.TUBE_PROXY_OPEN;
delete process.env.TUBE_PROXY_CLIENTS;
delete process.env.TUBE_BYPASS_HOSTS;

const proxy = require('../lib/proxy.js');
const upgrade = require('../lib/upgrade.js');
const clients = require('../lib/clients.js');
const postmortem = require('../lib/postmortem.js');

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const from = (remoteAddress) => ({ socket: { remoteAddress } });

const own = Object.keys(os.networkInterfaces()).reduce((all, name) => all.concat(os.networkInterfaces()[name]
    .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
    .map((entry) => entry.address)), []);

// Who may forward.
check('the set itself may, over loopback', clients.fromThisTv(from('127.0.0.1'))
    && clients.fromThisTv(from('::ffff:127.0.0.1')) && clients.fromThisTv(from('::1')), 'refused');

check('and on its own network address, which is how the container reaches the service',
    !own.length || clients.fromThisTv(from(own[0])), own.join());

check('another device on the network may not', !clients.fromThisTv(from('192.0.2.77'))
    && !clients.fromThisTv(from('::ffff:192.0.2.77')) && !clients.fromThisTv(from('')) && !clients.fromThisTv(null), 'let through');

process.env.TUBE_PROXY_CLIENTS = '192.0.2.77';
check('unless a developer names it, off a television', clients.fromThisTv(from('192.0.2.77')), 'refused');
delete process.env.TUBE_PROXY_CLIENTS;

// Where to.
check('the bypass takes the page to Google\'s hosts',
    ['rr3---sn-x.googlevideo.com', 'jnn-pa.googleapis.com', 'www.google.com:443', 'i.ytimg.ggpht.com', 'www.youtube.com']
        .every(clients.bypassAllows), 'refused one');

check('and nowhere else: not the home network, not lookalikes',
    ['192.168.1.1', '127.0.0.1:22', 'router.local', 'evilgoogle.com', 'google.com.evil.example', 'googlevideo.com.example', '']
        .every((host) => !clients.bypassAllows(host)), 'let one through');

// End to end, over a real socket.
const asked = { count: 0 };
const elsewhere = http.createServer((req, res) => {
    asked.count += 1;
    res.end('reached');
});

const target = http.createServer();
target.on('upgrade', (req, socket) => {
    asked.count += 1;
    socket.end('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
});

const app = proxy.create();
proxy.attachFallback(app);

const get = (port, path) => new Promise((done) => {
    http.get({ host: '127.0.0.1', port, path, timeout: 5000 }, (res) => {
        const read = { body: '' };
        res.on('data', (chunk) => { read.body += chunk; });
        res.on('end', () => done({ status: res.statusCode, body: read.body }));
    }).on('error', (error) => done({ status: 0, body: error.message }));
});

const raw = (port, address, text) => new Promise((done) => {
    const socket = net.connect(port, address, () => socket.write(text));
    const seen = { text: '' };
    const timer = setTimeout(() => { socket.destroy(); done(seen.text); }, 3000);
    socket.on('data', (chunk) => { seen.text += chunk; });
    socket.on('close', () => { clearTimeout(timer); done(seen.text); });
    socket.on('error', () => { clearTimeout(timer); done(seen.text); });
});

elsewhere.listen(0, '127.0.0.1', () => target.listen(0, '127.0.0.1', () => {
    const server = app.listen(0, '0.0.0.0', async () => {
        upgrade.attach(server, {});
        const port = server.address().port;

        try {
            const homeNetwork = await get(port, `/cors-bypass/http://127.0.0.1:${elsewhere.address().port}/admin`);
            check('a bypass to anywhere but Google is refused before anything is fetched',
                homeNetwork.status === 403 && asked.count === 0, `${homeNetwork.status} ${homeNetwork.body} asked ${asked.count}`);

            const tunnel = await raw(port, '127.0.0.1',
                `GET / HTTP/1.1\r\nhost: 127.0.0.1:${target.address().port}\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n`);
            check('the set itself still opens a forwarded upgrade', /^HTTP\/1\.1 101/.test(tunnel) && asked.count === 1, tunnel.slice(0, 40));

            // Seen from another address: the check reads the socket, so a stand-in socket is enough.
            const outsider = { headers: { host: 'x' }, socket: { remoteAddress: '192.0.2.77' } };
            const answered = { text: '' };
            server.emit('upgrade', outsider, { end: (text) => { answered.text = text; }, destroy() {} }, Buffer.alloc(0));
            check('but an upgrade from another device is answered 403 and goes nowhere',
                /^HTTP\/1\.1 403/.test(answered.text) && asked.count === 1, answered.text);

            const lines = postmortem.since(0).lines.filter((line) => line.what === 'refused').map((line) => line.text);
            check('and refusals are noted for the diagnostics, once per kind and address',
                lines.length === 2 && lines.every((line) => line.indexOf('/admin') === -1), JSON.stringify(lines));
        } catch (error) {
            check('harness', false, error.stack);
        }

        try { require('fs').unlinkSync(process.env.TUBE_LOG); } catch (e) { /* never written */ }
        server.close();
        elsewhere.close();
        target.close();

        const failed = results.filter((ok) => !ok).length;
        console.log(`\n${results.length - failed}/${results.length} checks passed.`);
        process.exit(failed ? 1 : 0);
    });
}));
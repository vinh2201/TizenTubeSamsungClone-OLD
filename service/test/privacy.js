'use strict';

// What the service writes about the person watching must not outlive its use or reach whoever shares the Wi-Fi:
// the values of a query string are dropped before a line is logged, the log can stay in memory, the diagnostics need
// the code the TV shows, and only the TV's own pages may write to the journal. The content staging, which used to
// stop the service answering while it ran, is checked here too: it is the same kind of "what the TV owes its owner".

const fs = require('fs');
const os = require('os');
const path = require('path');

const share = fs.mkdtempSync(path.join(os.tmpdir(), 'tube-privacy-'));
process.env.TUBE_LOG = path.join(share, 'service.log');

os.networkInterfaces = () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [{ address: '192.0.2.40', family: 'IPv4', internal: false }]
});

const results = [];
const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const { scrub } = require('../lib/scrub.js');
const postmortem = require('../lib/postmortem.js');
const pin = require('../lib/pin.js');
const { allow } = require('../lib/diagAccess.js');
const diagRoutes = require('../lib/diagRoutes.js');
const journalRoutes = require('../lib/journalRoutes.js');
const { stageOrFail, stageInSlices } = require('../lib/cobaltContent.js');

const logText = () => {
    try { return fs.readFileSync(process.env.TUBE_LOG, 'utf8'); } catch (e) { return ''; }
};

// ------------------------------------------------------------------ the log keeps names, not values
const reported = 'upstream failed on https://www.youtube.com/api/timedtext?v=abc123XYZ&obfuscatedGaiaId=1234567890&ip=203.0.113.9&cpn=Qw3r&t=44';
const scrubbed = scrub(reported);
check('the values of a query string are dropped', !/abc123XYZ|1234567890|203\.0\.113\.9|Qw3r/.test(scrubbed), scrubbed);
check('its names are kept, to tell what the request was', /timedtext\?v=~&obfuscatedGaiaId=~&ip=~&cpn=~&t=~/.test(scrubbed), scrubbed);
check('a line without a query is left alone', scrub('listening 192.0.2.40:8099') === 'listening 192.0.2.40:8099', scrub('listening 192.0.2.40:8099'));

postmortem.note('upstream', reported);
check('what reaches the log file is already scrubbed', logText().indexOf('timedtext?v=~') !== -1 && !/abc123XYZ|203\.0\.113\.9/.test(logText()), logText().slice(-200));
check('and what /diag reads from memory is too', !/abc123XYZ/.test(JSON.stringify(postmortem.since(0))), 'kept in memory');

// ------------------------------------------------------------------ the log can stay in memory
check('the log is in a file by default', postmortem.mode() === 'file', postmortem.mode());
check('a mode that does not exist is refused', postmortem.setMode('everywhere') === false, 'accepted');

postmortem.setMode('memory');
check('in memory mode what was written is removed', logText() === '', logText().slice(0, 100));

postmortem.note('upstream', 'a line written in memory mode');
check('and nothing is written afterwards', logText() === '', logText().slice(0, 100));
check('yet it can still be read', postmortem.read().indexOf('a line written in memory mode') !== -1, postmortem.read().slice(-100));

postmortem.setMode('file');
postmortem.note('upstream', 'a line written in file mode');
check('the file comes back when asked', logText().indexOf('a line written in file mode') !== -1, logText().slice(-100));

postmortem.forget();
check('forgetting removes what was written', logText() === '', logText().slice(0, 100));

// ------------------------------------------------------------------ the code
const code = pin.current();
check('the code is six digits', /^\d{6}$/.test(code), code);
check('and stays the same', pin.current() === code, pin.current());

// ------------------------------------------------------------------ who may read the diagnostics
const request = (address, extra) => Object.assign({ socket: { remoteAddress: address }, headers: {}, query: {} }, extra || {});
const response = () => {
    const out = { status: 200, headers: {}, body: null };
    out.status_ = (code) => { out.status = code; return out; };
    return Object.assign(out, {
        status: function setStatus(code) { out.code = code; return out; },
        type: () => out,
        setHeader: (name, value) => { out.headers[name] = value; },
        removeHeader: () => {},
        send: (body) => { out.body = body; return out; },
        json: (body) => { out.body = JSON.stringify(body); return out; },
        end: () => out
    });
};
const asked = (address, extra) => { const res = response(); const ok = allow(request(address, extra), res); return { ok, res }; };

check('the TV itself needs no code', asked('127.0.0.1').ok === true, 'refused');
check('nor does the TV by its address on the network', asked('192.0.2.40').ok === true, 'refused');

let outcome = asked('192.0.2.77');
check('another device on the network is refused without the code', outcome.ok === false && outcome.res.code === 403, JSON.stringify([outcome.ok, outcome.res.code]));
check('and told where the code is', /TV shows/.test(String(outcome.res.body)), String(outcome.res.body));

outcome = asked('192.0.2.77', { query: { k: code } });
check('with the code it may read', outcome.ok === true, 'refused');
check('and keeps it for the next page', /tube_pin=\d{6}/.test(outcome.res.headers['Set-Cookie'] || ''), JSON.stringify(outcome.res.headers));

outcome = asked('192.0.2.77', { headers: { cookie: `x=1; tube_pin=${code}` } });
check('the cookie is as good as the code', outcome.ok === true, 'refused');

for (let i = 0; i < 10; i += 1) asked('192.0.2.88', { query: { k: '000000' === code ? '111111' : '000000' } });
outcome = asked('192.0.2.88', { query: { k: code } });
check('guessing is stopped after a few wrong codes, even for the right one', outcome.ok === false && outcome.res.code === 429, JSON.stringify([outcome.ok, outcome.res.code]));
check('while another device with the code is not held up', asked('192.0.2.77', { query: { k: code } }).ok === true, 'refused');

// ------------------------------------------------------------------ the routes use it
const routes = {};
const app = { get: (route, handler) => { routes[route] = handler; } };
diagRoutes.attach(app);
journalRoutes.attach(app);

const call = (route, address, extra) => { const res = response(); routes[route](request(address, extra), res); return res; };

check('/diag is not given to a stranger', call('/diag', '192.0.2.77').code === 403, 'served');
check('nor the facts about this set', call('/__tube/facts', '192.0.2.77').code === 403, 'served');
check('nor the log', call('/__tube/log', '192.0.2.77').code === 403, 'served');
check('nor the switch for the log', call('/__tube/privacy', '192.0.2.77', { query: { log: 'memory' } }).code === 403, 'served');
check('the log is read by the TV itself', /nothing logged|\w/.test(String(call('/__tube/log', '127.0.0.1').body)), 'not served');

const switched = call('/__tube/privacy', '127.0.0.1', { query: { log: 'memory' } });
check('the TV can put the log in memory', /log: memory/.test(String(switched.body)) && postmortem.mode() === 'memory', String(switched.body));
postmortem.setMode('file');

check('a stranger cannot write to the journal', call('/__tube/journal', '192.0.2.77', { query: { m: 'tube: forged line' } }).code === 403, 'accepted');
check('the TV can', call('/__tube/journal', '127.0.0.1', { query: { m: 'page: a line from the page' } }).code === 204, 'refused');

// ------------------------------------------------------------------ staging that lets the service answer
const stock = path.join(share, 'stock');
for (let folder = 0; folder < 12; folder += 1) {
    fs.mkdirSync(path.join(stock, `d${folder}`, 'inner'), { recursive: true });
    for (let file = 0; file < 40; file += 1) fs.writeFileSync(path.join(stock, `d${folder}`, `f${file}.bin`), 'x');
    fs.writeFileSync(path.join(stock, `d${folder}`, 'inner', 'deep.bin'), 'x');
}

const whole = path.join(share, 'whole');
const sliced = path.join(share, 'sliced');
const listing = (root) => {
    const out = [];
    const walk = (dir) => fs.readdirSync(dir).forEach((name) => {
        const full = path.join(dir, name);
        if (fs.lstatSync(full).isSymbolicLink()) out.push(`${path.relative(root, full)} -> ${path.relative(stock, fs.readlinkSync(full))}`);
        else walk(full);
    });
    walk(root);
    return out.sort();
};

stageOrFail(whole, stock);

let slices = 0;
const timer = setInterval(() => { slices += 1; }, 0);
const startedAt = Date.now();

stageInSlices(sliced, stock, (staged) => {
    clearInterval(timer);

    check('staging in slices links the same files as the whole walk', !staged.error && JSON.stringify(listing(sliced)) === JSON.stringify(listing(whole)), staged.error ? staged.error.message : `${listing(sliced).length} against ${listing(whole).length}`);
    check('the event loop got turns while it ran', slices >= 2, `${slices} turns in ${Date.now() - startedAt} ms`);

    stageInSlices(sliced, stock, (again) => {
        check('a second run over what is already linked changes nothing and does not fail', !again.error && JSON.stringify(listing(sliced)) === JSON.stringify(listing(whole)), again.error && again.error.message);

        const passed = results.filter(Boolean).length;
        console.log(`\n${passed}/${results.length} checks passed.`);
        process.exit(passed === results.length ? 0 : 1);
    });
});

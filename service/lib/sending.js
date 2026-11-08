'use strict';

const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const postmortem = require('./postmortem.js');
const bigheaders = require('./bigheaders.js');

// A booting page opens about thirty requests at once.
const MOST_SOCKETS = 64;

// No socket timeout: a paused SABR stream is an idle socket, and a timeout would cut playback.
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: MOST_SOCKETS };
const httpsAgent = new https.Agent(AGENT_OPTIONS);
const httpAgent = new http.Agent(AGENT_OPTIONS);
const agentFor = (url) => (String(url).indexOf('https:') === 0 ? httpsAgent : httpAgent);

// Only the wait for headers is bounded, so a streaming body is never cut.
const HEADERS_DEADLINE = 20000;

const RETRIABLE = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'];

const BODIED = ['POST', 'PUT', 'PATCH'];

const isRepeatable = (req) => !!req && BODIED.indexOf(req.method) === -1;

const isRetriable = (error) => !!error
    && (RETRIABLE.indexOf(error.code) !== -1 || /socket hang up|premature close/i.test(error.message || ''));

// What node-fetch calls "The user aborted a request" when it was our own deadline that fired.
const NO_ANSWER = 'TUBE_NO_ANSWER';

const timedOut = (error) => (error && (error.name === 'AbortError' || /user aborted/i.test(error.message || ''))
    ? Object.assign(new Error(`no answer within ${HEADERS_DEADLINE / 1000}s`), { code: NO_ANSWER })
    : error);

// A request that got no answer on a connection that had been idle is as likely to have met a dead one as a slow server.
const worthAsking = (error) => isRetriable(error) || (!!error && error.code === NO_ANSWER);

// The address (without its query) of requests whose answer came with headers too big for node's parser. They are asked
// over http2 from the start, instead of failing once on every launch first.
const needsHttp2 = {};
const MOST_REMEMBERED = 50;
const pathOf = (url) => String(url).split('?')[0];

// Node 12 has no AbortController, and node-fetch accepts any signal whose constructor is named
// AbortSignal.
const SIGNAL = { constructor: { name: 'AbortSignal' } };

// Below node 8 node-fetch refuses any signal beside a streamed body, so those requests go unbounded.
const SIGNAL_BESIDE_STREAM = 'destroy' in require('stream').Readable.prototype;

const untilHeaders = (make) => {
    const held = { listeners: [] };
    const signal = Object.assign(Object.create(SIGNAL), {
        aborted: false,
        addEventListener: (_, listener) => { held.listeners = held.listeners.concat(listener); },
        removeEventListener: (_, listener) => {
            held.listeners = held.listeners.filter((other) => other !== listener);
        }
    });
    const timer = setTimeout(() => {
        signal.aborted = true;
        held.listeners.forEach((listener) => listener());
    }, HEADERS_DEADLINE);
    const stop = (answer) => { clearTimeout(timer); return answer; };

    return make(signal).then(stop, (error) => { stop(); throw error; });
};

const send = (url, req, headers, fresh) => {
    const body = isRepeatable(req) ? undefined : req;

    const options = {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        agent: fresh ? undefined : agentFor(url)
    };

    const attempt = (changed) => (body && !SIGNAL_BESIDE_STREAM
        ? fetch(url, Object.assign({}, options, changed))
        : untilHeaders((signal) => fetch(url, Object.assign({}, options, changed, { signal }))))
        .catch((error) => { throw timedOut(error); });

    const overHttp2 = () => bigheaders.fetchOverHttp2(url, { method: req.method, headers });
    const canUseHttp2 = !body && url.indexOf('https:') === 0;

    const normally = () => attempt().catch((error) => {
        if (bigheaders.isHeaderOverflow(error) && canUseHttp2) {
            postmortem.note('upstream', `header overflow on ${url.slice(0, 80)} — retrying over http2`);

            if (Object.keys(needsHttp2).length < MOST_REMEMBERED) needsHttp2[pathOf(url)] = true;
            return overHttp2();
        }

        // A streamed body cannot be sent twice.
        if (!worthAsking(error) || body) throw error;

        // The deadline's own error says all there is to say in one line; a stack would only fill the log.
        const why = error.code === NO_ANSWER ? error.message : postmortem.describe(error);

        postmortem.note('upstream', `${why} on ${url.slice(0, 80)} — retrying on a fresh connection`);

        return attempt({ agent: undefined });
    });

    if (canUseHttp2 && needsHttp2[pathOf(url)]) {
        return overHttp2().catch(() => {
            delete needsHttp2[pathOf(url)];
            return normally();
        });
    }

    return normally();
};

const textOf = (response) => response.text().then((text) => ({ response, text }));

const readText = (response, url, req, headers) => textOf(response).catch((error) => {
    if (!isRetriable(error) || !isRepeatable(req)) throw error;

    postmortem.note('upstream', `${postmortem.describe(error)} reading ${url.slice(0, 80)}`
        + ' — asking again');

    return send(url, req, headers, true).then(textOf);
});

module.exports = { send, readText };

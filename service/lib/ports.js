'use strict';

const port = (name, fallback) => Number(process.env[name]) || fallback;

// config.xml hard-codes PROXY in the 5.0 widget's --base_url, and npm run package fails if the two disagree.
const PROXY = port('TUBE_PROXY_PORT', 8099);

// What the 5.5 widget moves to when PROXY stays refused. Its boot screen is written by the service and names
// the port at every start, so nothing that is installed has to change. High ports, away from the ones other
// apps on a TV are known to take.
const SPARE = [18099, 21099, 28099];

const using = { port: PROXY };

module.exports = {
    PROXY,
    SPARE,
    DEV: port('TUBE_DEV_PORT', 8097),

    // What is answering now. PROXY is what config.xml and the tools know; anything that runs asks for this.
    current: () => using.port,
    use: (next) => { using.port = next; },

    // Every port the service may be found on, the one in use first.
    all: () => [using.port].concat([PROXY].concat(SPARE).filter((candidate) => candidate !== using.port))
};

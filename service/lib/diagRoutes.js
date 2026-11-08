'use strict';

const { page, thisTvRows } = require('./diagPage.js');
const { allow } = require('./diagAccess.js');
const postmortem = require('./postmortem.js');

const attach = (app) => {
    app.get('/diag', (req, res) => {
        if (!allow(req, res)) return;

        // No policy of ours: this one is read in a phone's browser, not in Cobalt.
        res.removeHeader('Content-Security-Policy');
        res.type('html').send(page(req.headers.host));
    });

    app.get('/__tube/facts', (req, res) => {
        if (!allow(req, res)) return;
        res.json(thisTvRows(req.headers.host));
    });

    // /__tube/privacy?log=memory (nothing is written to disk), ?log=file (the default), ?forget=1 (what was written goes).
    app.get('/__tube/privacy', (req, res) => {
        if (!allow(req, res)) return;

        if (req.query.log && !postmortem.setMode(String(req.query.log))) {
            return res.status(400).type('text/plain').send('log must be memory or file');
        }

        if (req.query.forget) postmortem.forget();

        return res.type('text/plain').send(`log: ${postmortem.mode()}${req.query.forget ? '; what was written has been removed' : ''}`);
    });
};

module.exports = { attach };

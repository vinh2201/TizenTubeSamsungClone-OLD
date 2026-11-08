'use strict';

const postmortem = require('./postmortem.js');
const { fromPage } = require('./pageLines.js');
const { allow } = require('./diagAccess.js');
const { fromThisTv } = require('./clients.js');

const attach = (app, hooks) => {
    const heard = (hooks && hooks.heard) || (() => undefined);

    // No console in the container, so this is the only way to read it.
    app.get('/__tube/log', (req, res) => {
        if (!allow(req, res)) return;
        res.type('text/plain').send(postmortem.read() || '(nothing logged)');
    });

    // Only the TV's own pages write to the journal; another device on the network could otherwise fill it with lines
    // that look like the service's own.
    app.get('/__tube/journal', (req, res) => {
        if (!fromThisTv(req)) return res.status(403).type('text/plain').send('tube: only this TV may write to the journal');

        const line = String(req.query.m || '');

        heard(line);
        fromPage(line);
        return res.status(204).end();
    });
};

module.exports = { attach };

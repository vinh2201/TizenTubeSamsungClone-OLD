'use strict';

const { appendFileSync, readFileSync, writeFileSync, statSync, renameSync, mkdirSync, unlinkSync } = require('fs');
const { dirname, join } = require('path');

const { scrub } = require('./scrub.js');

const LOG = process.env.TUBE_LOG || '/home/owner/share/tube/service.log';
const MAX_BYTES = 64 * 1024;

// 'file' keeps the log where a restart does not erase it. 'memory' keeps it only in this run, for the boot screen and
// for /diag, and writes nothing. The choice is kept next to the log.
const MODE_FILE = join(dirname(LOG), 'logmode');
const MODES = ['file', 'memory'];

const state = { ready: false, mode: null };

const mode = () => {
    if (state.mode) return state.mode;

    try {
        const kept = String(readFileSync(MODE_FILE, 'utf8')).trim();
        state.mode = MODES.indexOf(kept) === -1 ? 'file' : kept;
    } catch (e) {
        state.mode = 'file';
    }

    return state.mode;
};

// appendFileSync fails when the directory is missing, and note() swallows that failure.
const ensure = () => {
    if (state.ready) return;
    state.ready = true;

    try { mkdirSync(dirname(LOG), { recursive: true }); } catch (e) { }
};

const describe = (detail) => {
    if (!detail) return String(detail);
    if (typeof detail === 'string') return detail;

    const code = detail.code || detail.name || 'Error';

    if (detail.stack) return detail.stack;
    if (detail.message) return `${code}: ${detail.message}`;

    return String(detail);
};

// Also kept in memory, numbered, for the boot screen to ask from.
const MOST_KEPT = 400;
const kept = { lines: [], next: 0 };

const remember = (what, text) => {
    kept.lines = kept.lines.concat([{ seq: kept.next, at: Date.now(), what, text }]).slice(-MOST_KEPT);
    kept.next += 1;
};

const note = (what, detail) => {
    const text = scrub(describe(detail));
    remember(what, text);

    if (mode() === 'memory') return;

    try {
        ensure();
        try { if (statSync(LOG).size > MAX_BYTES) renameSync(LOG, `${LOG}.1`); } catch (e) { }
        appendFileSync(LOG, `${new Date().toISOString()}  ${what}: ${text}\n`);
    } catch (e) { /* logging must never be a reason to fail */ }
};

// A restarted service counts from 0 again, so asking past the end sends everything.
const since = (seq) => {
    const from = seq > kept.next ? 0 : seq;
    return { lines: kept.lines.filter((line) => line.seq >= from), next: kept.next };
};

const readOr = (file) => {
    try {
        return readFileSync(file, 'utf8');
    } catch (e) {
        return '';
    }
};

// The rotated file first, so the journal reads from the start.
const read = () => (mode() === 'memory'
    ? kept.lines.map((line) => `${new Date(line.at).toISOString()}  ${line.what}: ${line.text}`).join('\n')
    : readOr(`${LOG}.1`) + readOr(LOG));

// Everything written so far goes; what is kept in memory is only for this run.
const forget = () => {
    [LOG, `${LOG}.1`].forEach((file) => {
        try { unlinkSync(file); } catch (e) { /* not there */ }
    });
};

const setMode = (next) => {
    if (MODES.indexOf(next) === -1) return false;

    try {
        ensure();
        writeFileSync(MODE_FILE, next);
    } catch (e) { /* the choice then only holds until the next start */ }

    state.mode = next;
    if (next === 'memory') forget();

    return true;
};

const watch = () => {
    process.on('uncaughtException', (error) => {
        note('uncaught', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (error) => note('unhandled rejection', error));
    process.on('exit', (code) => { if (code) note('exit', `code ${code}`); });

    note('started', `pid ${process.pid}, node ${process.version}`);
};

module.exports = { describe, note, read, remember, since, watch, mode, setMode, forget };

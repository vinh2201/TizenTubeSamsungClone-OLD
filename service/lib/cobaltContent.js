'use strict';

// Stages Cobalt's own content as links, because --content replaces the directory wholesale.

const fs = require('fs');
const path = require('path');

const postmortem = require('./postmortem.js');

const PACKAGE = '/usr/apps/com.samsung.tv.cobalt';
const STOCK = `${PACKAGE}/content/app/cobalt/content`;

const DEEPEST = 6;
const MOST_FOUND = 12;

const note = (what, detail) => postmortem.note('cobalt', `${what}: ${postmortem.describe(detail)}`);

const isLink = (file) => {
    try {
        return fs.lstatSync(file).isSymbolicLink();
    } catch (e) {
        return false;
    }
};

// Folders stay real, so our certificate, the boot screen and Evergreen's files can be written
// beside the links.
const linkInto = (from, to) => {
    if (isLink(to)) fs.unlinkSync(to);
    fs.mkdirSync(to, { recursive: true });

    return fs.readdirSync(from).reduce((linked, entry) => {
        const source = path.join(from, entry);
        const target = path.join(to, entry);

        if (fs.statSync(source).isDirectory()) return linked + linkInto(source, target);
        if (isLink(target)) return linked;

        // Renamed into place, so a Cobalt starting meanwhile never finds the file missing.
        const staged = `${target}.${process.pid}`;
        fs.symlinkSync(source, staged);
        fs.renameSync(staged, target);
        return linked + 1;
    }, 0);
};

const isDirectory = (dir) => {
    try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; }
};

const cobaltIsInstalledHere = () => isDirectory(STOCK);

const listing = (dir) => {
    try { return fs.readdirSync(dir); } catch (e) { return []; }
};

// Content directories are the ones holding ssl/certs.
const findContent = (dir, depth) => (depth > DEEPEST ? [] : listing(dir).reduce((found, entry) => {
    const full = path.join(dir, entry);

    if (found.length >= MOST_FOUND || !isDirectory(full)) return found;
    if (entry === 'certs' && path.basename(dir) === 'ssl') return found.concat(path.dirname(dir));

    return found.concat(findContent(full, depth + 1));
}, []));

const locate = () => {
    if (isDirectory(STOCK)) return STOCK;

    const found = findContent(PACKAGE, 0);
    return found.find((dir) => isDirectory(path.join(dir, 'icu'))) || found[0] || null;
};

const discover = () => {
    if (!isDirectory(PACKAGE)) return `nothing at ${PACKAGE} either`;

    const found = findContent(PACKAGE, 0);

    return `${PACKAGE} holds [${listing(PACKAGE).join(', ')}]; content directories: `
        + `${found.length ? found.join(', ') : 'none readable'}`;
};

// Answered rather than thrown, so a staging failure goes the same way as everything else in
// prepare().
const stageOrFail = (content, from = STOCK) => {
    try {
        const linked = linkInto(from, content);
        if (linked) note('staged', `${linked} files linked into ${content}`);

        return {};
    } catch (error) {
        return { error };
    }
};

// How many entries are looked at before the event loop gets a turn.
const SLICE = 200;

// The walk of linkInto, a slice at a time. It runs on every start and looks at every file of the stock content, which
// on a TV's storage can take long enough that the service answered nothing meanwhile (the boot screen then said it
// was not running). This way the port is open, and says it is starting, while the content is being staged.
const stageInSlices = (content, from, done) => {
    const directories = [{ from, to: content }];
    const walk = { current: null, linked: 0 };

    const open = (directory) => {
        if (isLink(directory.to)) fs.unlinkSync(directory.to);
        fs.mkdirSync(directory.to, { recursive: true });

        walk.current = { from: directory.from, to: directory.to, names: fs.readdirSync(directory.from), at: 0 };
    };

    const step = () => {
        try {
            for (let looked = 0; looked < SLICE;) {
                if (!walk.current) {
                    if (!directories.length) {
                        if (walk.linked) note('staged', `${walk.linked} files linked into ${content}`);
                        return done({});
                    }

                    open(directories.pop());
                }

                const directory = walk.current;

                if (directory.at >= directory.names.length) {
                    walk.current = null;
                } else {
                    const name = directory.names[directory.at];
                    directory.at += 1;
                    looked += 1;

                    const source = path.join(directory.from, name);
                    const target = path.join(directory.to, name);

                    if (fs.statSync(source).isDirectory()) {
                        directories.push({ from: source, to: target });
                    } else if (!isLink(target)) {
                        const staged = `${target}.${process.pid}`;
                        fs.symlinkSync(source, staged);
                        fs.renameSync(staged, target);
                        walk.linked += 1;
                    }
                }
            }
        } catch (error) {
            return done({ error });
        }

        return setImmediate(step);
    };

    return setImmediate(step);
};

module.exports = { STOCK, cobaltIsInstalledHere, discover, findContent, locate, stageOrFail, stageInSlices };

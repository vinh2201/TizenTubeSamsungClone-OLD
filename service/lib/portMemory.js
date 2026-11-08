'use strict';

const fs = require('fs');
const path = require('path');

const ports = require('./ports.js');

// Next to the log, which is where the service already keeps what must outlive a restart.
const FILE = path.join(path.dirname(process.env.TUBE_LOG || '/home/owner/share/tube/service.log'), 'port');

// A set that had to move to a spare port starts on it again. Going back to the first one would change the
// address the page is served from, and with it what the viewer is signed in to.
const recall = () => {
    try {
        const kept = Number(String(fs.readFileSync(FILE, 'utf8')).trim());
        return [ports.PROXY].concat(ports.SPARE).indexOf(kept) === -1 ? null : kept;
    } catch (e) {
        return null;
    }
};

const remember = (port) => {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, String(port));
    } catch (e) {
        // Not being able to remember only means starting from the first port again.
    }
};

module.exports = { recall, remember, FILE };

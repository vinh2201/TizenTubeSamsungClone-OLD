'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Next to the log, which is where the service already keeps what must outlive a restart.
const FILE = path.join(path.dirname(process.env.TUBE_LOG || '/home/owner/share/tube/service.log'), 'pin');

const fresh = () => {
    const digits = String(crypto.randomBytes(4).readUInt32BE(0) % 1000000);
    return `${'000000'.slice(digits.length)}${digits}`;
};

const held = { pin: null };

// The code that lets a phone read the diagnostics. It is made once, shown on the TV only (in the address the boot
// screen tells the viewer to open), and kept so that the address on the screen stays good after a restart.
const current = () => {
    if (held.pin) return held.pin;

    try {
        const kept = String(fs.readFileSync(FILE, 'utf8')).trim();
        if (/^\d{6}$/.test(kept)) {
            held.pin = kept;
            return held.pin;
        }
    } catch (e) { /* none yet */ }

    held.pin = fresh();

    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, held.pin);
    } catch (e) { /* a code that is only good until the next start still keeps strangers out */ }

    return held.pin;
};

module.exports = { current, FILE };

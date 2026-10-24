import { warn } from '../../framework/index.js';
import { ROWS, claimActionRows, claimBooleanRows } from './settingComponents.js';
import { claimVersionPanel } from './aboutPatch.js';

const SETTLING_ATTEMPTS = 20;
const SETTLING_EVERY = 250;
const PATIENT_EVERY = 500;
const PATIENT_ATTEMPTS = 120;

const WATCH_EVERY = 1000;
const ROWS_UNCLAIMED_BEFORE_WARNING = 10;

const watching = { timer: null, unclaimed: 0 };

const claimAll = () => {
    const claimed = claimBooleanRows();
    const annotated = claimActionRows();
    const stamped = claimVersionPanel();

    return claimed && annotated && stamped;
};

// The rows are drawn when the Settings page is opened, which can be long after the response that carried
// them, so the short retry that follows a response is not the only chance to claim them.
const watchDrawnRows = () => {
    if (watching.timer) return;

    watching.timer = setInterval(() => {
        try {
            if (typeof document.querySelector !== 'function' || !document.querySelector(ROWS)) return;

            if (claimAll()) {
                clearInterval(watching.timer);
                watching.timer = null;
                return;
            }

            watching.unclaimed += 1;
            if (watching.unclaimed === ROWS_UNCLAIMED_BEFORE_WARNING) {
                warn('settings', `rows are on screen but could not all be claimed: switches ${claimBooleanRows()}, notes ${claimActionRows()}, version ${claimVersionPanel()}`);
            }
        } catch (failure) {
            warn('settings', `watching for drawn rows failed: ${failure && failure.message}`);
        }
    }, WATCH_EVERY);

    // Never what keeps a test process alive.
    if (watching.timer && typeof watching.timer.unref === 'function') watching.timer.unref();
};

// One retry at a time: a response arrives every time the Settings page is opened.
const retrying = { yes: false };

const claimDrawnRows = () => {
    if (retrying.yes) return;
    retrying.yes = true;

    const step = (attempt) => {
        if (claimAll()) {
            retrying.yes = false;
            return;
        }

        const settling = attempt < SETTLING_ATTEMPTS;
        const done = (!settling && !document.querySelector(ROWS)) || attempt >= SETTLING_ATTEMPTS + PATIENT_ATTEMPTS;

        if (done) {
            retrying.yes = false;
            watchDrawnRows();
            return;
        }

        setTimeout(() => step(attempt + 1), settling ? SETTLING_EVERY : PATIENT_EVERY);
    };

    step(0);
};

export { claimDrawnRows, watchDrawnRows };

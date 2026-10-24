import { configRead, findByPrototype, findBySource, findComponent, sourceOf, warn } from '../../framework/index.js';

const getterOf = (prototype, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    return descriptor && typeof descriptor.get === 'function' ? descriptor.get : null;
};

const BOOLEAN_TAG = 'ytlr-setting-boolean-renderer';

const hasBooleanShape = (prototype) => !!(
    getterOf(prototype, 'enabled')
    && getterOf(prototype, 'enabledLabel')
    && getterOf(prototype, 'disabledLabel'));

// The row on screen says which class is the switch. The first class in the registry with the same getters can
// be another component that merely shares them, and claiming that one leaves the real rows untouched.
const drawnBooleanRow = () => {
    try {
        const drawn = findComponent(BOOLEAN_TAG);
        return drawn && drawn.prototype && hasBooleanShape(drawn.prototype) ? drawn : null;
    } catch (e) {
        return null;
    }
};

const findBooleanRow = () => {
    const drawn = drawnBooleanRow();
    if (drawn) return { component: drawn, how: 'the row on screen' };

    const found = findByPrototype(hasBooleanShape);
    return found ? { component: found, how: 'the registry' } : null;
};

const settingOf = (endpoint) => {
    const datas = endpoint
        && endpoint.setClientSettingEndpoint
        && endpoint.setClientSettingEndpoint.settingDatas;

    const data = datas && datas[0];
    if (!data || !data.clientSettingEnum || typeof data.boolValue !== 'boolean') return null;

    const key = data.clientSettingEnum.item;
    return configRead(key) === undefined ? null : { key, on: data.boolValue };
};

const state = { booleans: false, notes: false, redrawName: null };

function claimBooleanRows() {
    if (state.booleans) return true;

    const found = findBooleanRow();
    if (!found) return false;

    const component = found.component;
    const original = getterOf(component.prototype, 'enabled');
    if (!original) return false;

    Object.defineProperty(component.prototype, 'enabled', {
        configurable: true,
        get: function () {
            const data = this.props && this.props.data;
            const ours = data && settingOf(data.enableServiceEndpoint);

            return ours ? configRead(ours.key) === ours.on : original.call(this);
        }
    });

    state.booleans = true;
    warn('settings', `switch rows claimed from ${found.how}`);

    // Rows drawn before the claim still show YouTube's own value.
    redrawSettingRows();
    return true;
}

const NOTE_ROWS = ['ytlr-setting-action-renderer', 'ytlr-setting-boolean-renderer'];

// Built with YouTube's own hyperscript since nodes carry a private stamp — its minified body returns a `{type,props,children}` object, not `.type = x`.
const findHyperscript = () => findBySource('type:', 'props:', 'children:');

const noteFor = (H, note) => H(
    'div',
    { className: 'wFmJpd', idomKey: 'tube-note' },
    H('div', { className: 'vAMQc', 'aria-label': note }, note)
);

const withNote = (original, H) => function withTubeNote(props, rowState) {
    const tree = original.call(this, props, rowState);
    const note = props && props.data && props.data.tubeNote;

    if (note && tree && Array.isArray(tree.children)) tree.children.push(noteFor(H, note));

    return tree;
};

// Rows already on screen were built before the accessor existed; reassigning makes it fire.
const restamp = (row) => {
    const instance = row.__instance;
    if (!instance || !Object.prototype.hasOwnProperty.call(instance, 'template')) return;

    const original = instance.template;
    delete instance.template;
    instance.template = original;
};

// `template` is assigned per instance in the constructor, so the wrap has to be an accessor.
const claimNotesOn = (tag, H) => {
    const component = findComponent(tag);
    if (!component) return false;

    Object.defineProperty(component.prototype, 'template', {
        configurable: true,
        get: function () { return this.tubeTemplate; },
        set: function (original) { this.tubeTemplate = withNote(original, H); }
    });

    Array.from(document.querySelectorAll(tag)).forEach(restamp);
    return true;
};

function claimActionRows() {
    if (state.notes) return true;

    const H = findHyperscript();
    if (!H) return false;

    const claimed = NOTE_ROWS.map((tag) => claimNotesOn(tag, H));
    if (claimed.indexOf(false) !== -1) return false;

    state.notes = true;
    redrawSettingRows();
    return true;
}

const ROWS = [
    'ytlr-setting-boolean-renderer',
    'ytlr-setting-single-option-menu-renderer',
    'ytlr-setting-action-renderer',
    'ytlr-setting-app-version'
].join(',');

// The constructor matches the same shape as the redraw, and calling one without `new` throws.
const redrawsFrom = (prototype) => Object.getOwnPropertyNames(prototype).find((key) => {
    if (key === 'constructor') return false;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    const method = descriptor && descriptor.value;
    if (typeof method !== 'function' || method.length !== 0) return false;

    const source = sourceOf(method);
    return source.indexOf('this.state') !== -1 && source.indexOf('Object.assign') === -1;
});

const findRedraw = (instance) => {
    const walk = (prototype) => {
        if (!prototype || prototype === Object.prototype) return null;

        return redrawsFrom(prototype) || walk(Object.getPrototypeOf(prototype));
    };

    return walk(Object.getPrototypeOf(instance));
};

function redrawSettingRows() {
    // Locating the name reads the source of every method on the prototype chain, so it is remembered.
    const redraw = (row) => {
        const instance = row.__instance;
        if (!instance) return;

        if (!state.redrawName) state.redrawName = findRedraw(instance);

        const method = state.redrawName && instance[state.redrawName];
        if (typeof method === 'function') method.call(instance);
    };

    Array.from(document.querySelectorAll(ROWS)).forEach(redraw);
}

export { claimBooleanRows, claimActionRows, redrawSettingRows, ROWS };

/** Contract test for the hand-written client bundle (no browser needed). */
let loaded;

globalThis.window = {
  __ModuleLoader__: {
    load(info) {
      loaded = info;
    },
  },
};

await import('../lib/client.js');

if (!loaded || loaded.id !== 'dsh-masterduel') throw new Error('loader not called with the right id');

const react = {
  createElement: (...args) => ({ args }),
};

const module = loaded.factory((mod) => {
  if (mod === 'react') return react;
  throw new Error('unexpected require: ' + mod);
});

if (module.name !== 'masterduel') throw new Error('bad name');
if (!Array.isArray(module.inject) || !module.inject.includes('slots')) throw new Error('bad inject');
if (typeof module.apply !== 'function') throw new Error('missing apply');

const registrations = [];
const ctx = {
  slots: {
    inject(slot, generator) {
      if (slot !== 'main' && slot !== 'sidebar.panellist') throw new Error('bad slot: ' + slot);
      const iterator = generator();
      let step = iterator.next();
      while (!step.done) step = iterator.next({});
    },
    register(spec, component) {
      registrations.push({ spec, component });
      return () => {};
    },
  },
};

module.apply(ctx);

if (registrations.length !== 2) throw new Error('expected two registrations, got ' + registrations.length);
const main = registrations.find((r) => r.spec.name === 'main');
const panellist = registrations.find((r) => r.spec.name === 'sidebar.panellist');
if (!main || main.spec.key !== 'masterduel') throw new Error('main panel not registered');
if (!panellist || panellist.spec.id !== 'masterduel') throw new Error('sidebar entry not registered');
if (panellist.spec.label() !== '\u6e38\u620f\u738b MD') throw new Error('bad label: ' + panellist.spec.label());

const tree = JSON.stringify(main.component({}));
if (!tree.includes('/dsh-masterduel/panel')) throw new Error('iframe src missing: ' + tree.slice(0, 300));

console.log('client contract OK:', {
  main: main.spec.key,
  sidebar: panellist.spec.id,
  label: panellist.spec.label(),
  order: panellist.spec.order,
});

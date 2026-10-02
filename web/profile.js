(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./replay.js'), require('./rewards.js'), require('./controls.js'));
  else root.PulseProfile = factory(root.PulseEngine, root.PulseReplay, root.PulseRewards, root.PulseControls);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Engine, Replay, Rewards, Controls) {
  'use strict';
  // Keep the original gameplay save schema and storage key. New optional data is
  // sanitized independently so old scores never depend on a replay being present.
  function cleanSave(raw) {
    const save = Engine.cleanSave(raw);
    raw = raw && typeof raw === 'object' ? raw : {};
    save.ghostEnabled = typeof raw.ghostEnabled === 'boolean' ? raw.ghostEnabled : true;
    save.equipped = Rewards.cleanEquipped(raw.equipped, save);
    save.replays = Replay.cleanArchive(raw.replays);
    save.controls = Controls.clean(raw.controls);
    return save;
  }
  return Object.freeze({ cleanSave: cleanSave });
});

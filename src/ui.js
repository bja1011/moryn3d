/**
 * Thin DOM layer: loading overlay, layer toggles, cursor readout and the
 * building info panel. Markup lives in index.html.
 */
const $ = (id) => document.getElementById(id);

/** Click handler that drops focus afterwards, so Space (jump) cannot re-press the button. */
const onClick = (id, fn) =>
  $(id).addEventListener('click', (e) => {
    e.currentTarget.blur();
    fn();
  });

const STAGE_LABELS = {
  download: 'Downloading heightmap',
  decode: 'Decoding 16-bit heightmap',
  resample: 'Building elevation grid',
};

export function createUI() {
  const loader = $('loader');
  const loaderText = $('loader-text');
  const loaderBar = $('loader-bar');
  const readout = $('readout');
  const info = $('info');
  const infoBody = $('info-body');
  const stats = $('stats');

  $('info-close').addEventListener('click', () => {
    info.hidden = true;
    onCloseInfo?.();
  });
  let onCloseInfo = null;

  return {
    progress(stage, value) {
      loaderText.textContent = STAGE_LABELS[stage] ?? stage;
      loaderBar.style.width = `${Math.round((value ?? 0) * 100)}%`;
    },

    status(text) {
      loaderText.textContent = text;
    },

    ready() {
      loader.classList.add('done');
      setTimeout(() => (loader.hidden = true), 600);
    },

    fail(message) {
      loaderText.textContent = message;
      loader.classList.add('error');
    },

    /** Wires a checkbox (by id) to a layer's visibility. */
    bindLayer(id, object) {
      const box = $(id);
      if (!object) {
        box.disabled = true;
        box.closest('label').classList.add('unavailable');
        return;
      }
      box.checked = object.visible;
      box.addEventListener('change', () => (object.visible = box.checked));
    },

    onReset(fn) {
      onClick('reset-view', fn);
    },

    onToggleMode(fn) {
      onClick('toggle-mode', fn);
    },

    /** Swaps hints and button labels; shows the click-to-play prompt until the mouse is captured. */
    setMode(mode, locked) {
      for (const el of document.querySelectorAll('.hint[data-mode]')) el.hidden = el.dataset.mode !== mode;
      $('toggle-mode').textContent = mode === 'play' ? 'Map view' : 'Back to game';
      $('reset-view').textContent = mode === 'play' ? 'Respawn' : 'Reset view';
      $('play-prompt').hidden = mode !== 'play' || locked;
      document.body.classList.toggle('playing', mode === 'play');
    },

    setStats(text) {
      stats.textContent = text;
    },

    setReadout(geo) {
      readout.textContent = geo
        ? `${geo.lat.toFixed(5)}° N  ${geo.lon.toFixed(5)}° E  ·  ${geo.elevation.toFixed(1)} m a.s.l.`
        : '';
    },

    showBuilding(record, onClose) {
      onCloseInfo = onClose;
      const p = record.props;
      const address = [p['addr:street'] ?? p['addr:place'], p['addr:housenumber']].filter(Boolean).join(' ');
      const rows = [
        ['Name', p.name],
        ['Type', p.building === 'yes' ? 'building' : p.building],
        ['Address', address],
        ['Height', `${record.height.toFixed(1)} m${p.height ? '' : ' (estimated)'}`],
        ['Levels', p['building:levels']],
        ['Roof', record.roofShape],
        ['Ground', `${record.ground.toFixed(1)} m a.s.l.`],
        ['OSM', p['@id']],
      ].filter(([, v]) => v);

      infoBody.replaceChildren(
        ...rows.flatMap(([k, v]) => {
          const dt = document.createElement('dt');
          const dd = document.createElement('dd');
          dt.textContent = k;
          dd.textContent = v;
          return [dt, dd];
        }),
      );
      info.hidden = false;
    },

    hideBuilding() {
      info.hidden = true;
    },
  };
}

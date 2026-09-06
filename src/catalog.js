// Built-in models and wardrobe shown as clickable thumbnails in the Studio.
// Each entry is a bundled asset (Vite fingerprints these at build time), so
// adding a new piece is: drop the file in src/assets/… and add one line here.
//
// `src` is a same-origin URL to the fingerprinted asset. PresetPicker fetches
// it and hands the caller a File, so the rest of the pipeline (prepareImage →
// generateImage) is unchanged from a manual upload.

import sampleModel from './assets/models/sample-model.jpg';
import lifetimeTruckerCap from './assets/wardrobe/lifetime-trucker-cap.jpg';
import blueLogoCap from './assets/wardrobe/blue-logo-cap.jpg';

/** Selectable subjects — one click fills the Subject slot. */
export const MODELS = [
  { id: 'sample-model', label: 'Sample model', src: sampleModel },
];

/** Selectable clothing — one click fills the Attribute slot. */
export const WARDROBE = [
  { id: 'lifetime-trucker-cap', label: 'Life Time trucker cap', src: lifetimeTruckerCap },
  { id: 'blue-logo-cap', label: 'Blue logo cap', src: blueLogoCap },
];

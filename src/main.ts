import { initFederation } from '@angular-architects/native-federation';

// Entry point for the User native-federation remote. `initFederation()` reads the
// `federation.manifest.json` asset and registers this remote's exposed modules
// (`./routes` = USER_ROUTES) with the module-federation runtime so the host shell
// can load them at `/user/**` without bundling them at build time.
//
// Initialisation MUST complete before Angular bootstraps, because the host may
// have already registered remote entries; we defer `import('./bootstrap')` until
// `initFederation()` resolves so the Angular DI environment is set up after the
// federation manifest is ready.
initFederation()
  .catch((err) => console.error(err))
  .then(() => import('./bootstrap'))
  .catch((err) => console.error(err));

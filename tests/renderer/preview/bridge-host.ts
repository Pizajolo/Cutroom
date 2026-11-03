import { installHost } from '../../../src/compositions/bridge/host';
// Test-only injection; production receives the exact app origin from main.
installHost(window, new URL(document.referrer).origin);

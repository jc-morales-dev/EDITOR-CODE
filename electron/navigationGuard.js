import path from 'path';
import { fileURLToPath } from 'url';
import { isInsideRoot } from './pathGuard.js';

/**
 * Solo permite que la ventana privilegiada permanezca en el origen con el que
 * arrancó. En producción, las rutas file: también quedan confinadas a dist/.
 */
export function isAllowedNavigation(startUrl, targetUrl) {
  try {
    const start = new URL(startUrl);
    const target = new URL(targetUrl);

    if (start.username || start.password || target.username || target.password) {
      return false;
    }

    if (start.protocol === 'file:') {
      if (target.protocol !== 'file:') return false;
      const appRoot = path.dirname(fileURLToPath(start));
      return isInsideRoot(appRoot, fileURLToPath(target));
    }

    if (!['http:', 'https:'].includes(start.protocol)) return false;
    return target.origin === start.origin;
  } catch {
    return false;
  }
}

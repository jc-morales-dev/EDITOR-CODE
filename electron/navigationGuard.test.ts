import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';
// @ts-expect-error módulo JS sin tipos: el proceso principal es JavaScript
import { isAllowedNavigation } from './navigationGuard.js';

describe('isAllowedNavigation', () => {
  it('acepta rutas y fragmentos del mismo origen de desarrollo', () => {
    const start = 'http://localhost:5173/';
    expect(isAllowedNavigation(start, 'http://localhost:5173/settings')).toBe(true);
    expect(isAllowedNavigation(start, 'http://localhost:5173/#preview')).toBe(true);
  });

  it('rechaza otro origen, credenciales embebidas y protocolos externos', () => {
    const start = 'http://localhost:5173/';
    expect(isAllowedNavigation(start, 'https://example.com/')).toBe(false);
    expect(isAllowedNavigation(start, 'http://attacker@localhost:5173/')).toBe(false);
    expect(isAllowedNavigation(start, 'javascript:alert(1)')).toBe(false);
  });

  it('mantiene una app file dentro de su carpeta de distribución', () => {
    const dist = path.resolve('dist');
    const start = pathToFileURL(path.join(dist, 'index.html')).href;
    expect(isAllowedNavigation(start, pathToFileURL(path.join(dist, 'assets', 'app.js')).href)).toBe(true);
    expect(isAllowedNavigation(start, pathToFileURL(path.resolve(dist, '..', 'secrets.txt')).href)).toBe(false);
    expect(isAllowedNavigation(start, 'https://example.com/')).toBe(false);
  });

  it('rechaza URLs que no se pueden analizar', () => {
    expect(isAllowedNavigation('not a url', 'https://example.com')).toBe(false);
  });
});

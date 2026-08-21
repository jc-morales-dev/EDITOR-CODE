import path from 'path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo JS sin tipos: el proceso principal es JavaScript
import { isInsideRoot, isSafeFileName, resolveInsideRoot } from './pathGuard.js';

const ROOT = path.resolve('/proyecto');

describe('isInsideRoot', () => {
  it('acepta la propia raíz', () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
  });

  it('acepta ficheros y carpetas dentro', () => {
    expect(isInsideRoot(ROOT, path.join(ROOT, 'src'))).toBe(true);
    expect(isInsideRoot(ROOT, path.join(ROOT, 'src', 'a', 'b.ts'))).toBe(true);
  });

  it('rechaza subir por encima de la raíz', () => {
    expect(isInsideRoot(ROOT, path.resolve(ROOT, '..'))).toBe(false);
    expect(isInsideRoot(ROOT, path.resolve(ROOT, '..', 'otro', 'secreto.txt'))).toBe(false);
  });

  it('rechaza el escape que vuelve sobre sus pasos', () => {
    expect(isInsideRoot(ROOT, path.resolve(ROOT, 'src', '..', '..', 'fuera.txt'))).toBe(false);
  });

  it('no se deja engañar por un hermano con el mismo prefijo', () => {
    // El fallo clásico de comparar con startsWith sobre texto plano.
    expect(isInsideRoot(ROOT, path.resolve('/proyecto-malo', 'x.ts'))).toBe(false);
    expect(isInsideRoot(ROOT, path.resolve('/proyectoX'))).toBe(false);
  });

  it('tolera la barra final en la raíz', () => {
    expect(isInsideRoot(ROOT + path.sep, path.join(ROOT, 'a.ts'))).toBe(true);
  });

  it('rechaza cuando falta la raíz o el destino', () => {
    expect(isInsideRoot('', path.join(ROOT, 'a.ts'))).toBe(false);
    expect(isInsideRoot(ROOT, '')).toBe(false);
    expect(isInsideRoot(null as never, ROOT)).toBe(false);
  });
});

describe('resolveInsideRoot', () => {
  it('devuelve la ruta absoluta de algo que está dentro', () => {
    expect(resolveInsideRoot(ROOT, 'src', 'index.ts')).toBe(path.join(ROOT, 'src', 'index.ts'));
  });

  it('lanza al intentar salir con ..', () => {
    expect(() => resolveInsideRoot(ROOT, '..', '..', 'evil.txt')).toThrow(/fuera del proyecto/);
  });

  it('lanza con una ruta absoluta ajena', () => {
    // path.resolve descarta lo anterior ante un absoluto: sin comprobación,
    // esto escribiría donde le diera la gana.
    expect(() => resolveInsideRoot(ROOT, path.resolve('/etc/passwd'))).toThrow(/fuera del proyecto/);
  });

  it('lanza si no hay proyecto abierto', () => {
    expect(() => resolveInsideRoot(null as never, 'a.ts')).toThrow(/No hay proyecto abierto/);
  });
});

describe('isSafeFileName', () => {
  it('acepta nombres normales', () => {
    for (const n of ['index.ts', 'mi archivo.md', '.gitignore', 'a-b_c.1.txt']) {
      expect(isSafeFileName(n)).toBe(true);
    }
  });

  it('rechaza separadores de ruta', () => {
    for (const n of ['../evil', 'a/b', 'a\\b', '/absoluto']) {
      expect(isSafeFileName(n)).toBe(false);
    }
  });

  it('rechaza vacíos y referencias relativas', () => {
    for (const n of ['', '   ', '.', '..']) {
      expect(isSafeFileName(n)).toBe(false);
    }
  });

  it('rechaza el byte nulo, que trunca rutas en las llamadas al sistema', () => {
    expect(isSafeFileName('ok.txt\0.png')).toBe(false);
  });

  it('rechaza lo que no sea texto', () => {
    for (const n of [null, undefined, 42, {}, []]) {
      expect(isSafeFileName(n as never)).toBe(false);
    }
  });
});

import path from 'path';
import fs from 'fs';
import os from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo JS sin tipos: el proceso principal es JavaScript
import {
  isInsideRoot,
  isSafeFileName,
  normalizeGitPathspecs,
  resolveExistingInsideRoot,
  resolveInsideRoot,
  resolveMutableExistingInsideRoot,
  resolveNewInsideRoot,
  resolveTerminalCwd,
} from './pathGuard.js';

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

describe('resolveTerminalCwd', () => {
  let terminalRoot: string;
  let childDir: string;
  let outsideDir: string;

  beforeAll(() => {
    terminalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-root-'));
    childDir = path.join(terminalRoot, 'src');
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-outside-'));
    fs.mkdirSync(childDir);
  });

  afterAll(() => {
    fs.rmSync(terminalRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('usa la raíz abierta cuando no se solicita cwd', () => {
    expect(resolveTerminalCwd(terminalRoot)).toBe(fs.realpathSync(terminalRoot));
  });

  it('acepta un cwd dentro del proyecto', () => {
    expect(resolveTerminalCwd(terminalRoot, childDir)).toBe(fs.realpathSync(childDir));
  });

  it('rechaza un cwd fuera del proyecto', () => {
    expect(() => resolveTerminalCwd(terminalRoot, outsideDir)).toThrow(/fuera del proyecto/);
  });

  it('rechaza un enlace interno que resuelve fuera del proyecto', () => {
    const linkPath = path.join(terminalRoot, 'outside-link');
    fs.symlinkSync(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => resolveTerminalCwd(terminalRoot, linkPath)).toThrow(/fuera del proyecto/);
  });
});

describe('physical path confinement', () => {
  let root: string;
  let childDir: string;
  let outsideDir: string;
  let insideLink: string;
  let danglingLink: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-fs-root-'));
    childDir = path.join(root, 'src');
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-fs-outside-'));
    fs.mkdirSync(childDir);
    fs.writeFileSync(path.join(childDir, 'inside.txt'), 'inside');
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside');
    fs.symlinkSync(
      outsideDir,
      path.join(root, 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    insideLink = path.join(root, 'inside-link');
    fs.symlinkSync(childDir, insideLink, process.platform === 'win32' ? 'junction' : 'dir');
    danglingLink = path.join(root, 'dangling-link');
    fs.symlinkSync(
      path.join(outsideDir, 'missing'),
      danglingLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('acepta una ruta física existente dentro del proyecto', () => {
    expect(resolveExistingInsideRoot(root, 'src', 'inside.txt')).toBe(
      fs.realpathSync(path.join(childDir, 'inside.txt')),
    );
  });

  it('rechaza un fichero alcanzado mediante un junction interno', () => {
    expect(() => resolveExistingInsideRoot(root, 'outside-link', 'secret.txt')).toThrow(
      /fuera del proyecto/,
    );
  });

  it('permite crear dentro de una carpeta real del proyecto', () => {
    expect(resolveNewInsideRoot(root, childDir, 'new.txt')).toBe(path.join(childDir, 'new.txt'));
  });

  it('rechaza crear dentro de un junction que apunta fuera', () => {
    expect(() => resolveNewInsideRoot(root, path.join(root, 'outside-link'), 'new.txt')).toThrow(
      /fuera del proyecto/,
    );
  });

  it('mantiene la ruta lexical para una mutación normal', () => {
    expect(resolveMutableExistingInsideRoot(root, 'src', 'inside.txt')).toBe(
      path.join(root, 'src', 'inside.txt'),
    );
  });

  it('rechaza mutar un enlace aunque su destino esté dentro', () => {
    expect(() => resolveMutableExistingInsideRoot(root, insideLink)).toThrow(/enlaces simbólicos/);
  });

  it('rechaza un enlace colgante como destino nuevo', () => {
    expect(() => resolveNewInsideRoot(root, root, path.basename(danglingLink))).toThrow(
      /enlaces simbólicos/,
    );
  });
});

describe('normalizeGitPathspecs', () => {
  it('normaliza rutas internas y conserva la raíz explícita', () => {
    expect(normalizeGitPathspecs(ROOT, ['src/index.ts', '.'])).toEqual([
      ':(literal)src/index.ts',
      '.',
    ]);
  });

  it('trata como literales los caracteres especiales de pathspec', () => {
    expect(normalizeGitPathspecs(ROOT, ['src/[draft]*.ts'])).toEqual([
      ':(literal)src/[draft]*.ts',
    ]);
  });

  it('rechaza escapes, entradas vacías y valores que no son listas', () => {
    expect(() => normalizeGitPathspecs(ROOT, ['../outside.txt'])).toThrow(/fuera del proyecto/);
    expect(() => normalizeGitPathspecs(ROOT, [''])).toThrow(/no válida/);
    expect(() => normalizeGitPathspecs(ROOT, null as never)).toThrow(/al menos una ruta/);
  });
});

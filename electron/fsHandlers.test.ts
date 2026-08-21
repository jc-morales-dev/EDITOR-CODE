import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error módulo JS sin tipos: el proceso principal es JavaScript
import { resolveInsideRoot, isSafeFileName } from './pathGuard.js';

/**
 * Integración contra disco real.
 *
 * pathGuard.test.ts comprueba la función aislada; esto comprueba que aplicarla
 * como lo hacen los handlers de main.js impide de verdad escribir, leer o
 * borrar fuera del proyecto. Se reproduce aquí la misma secuencia de
 * llamadas que hace cada handler, sobre carpetas temporales de verdad.
 */

let tmp: string;
let projectRoot: string;
let fueraDelProyecto: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zenith-test-'));
  projectRoot = path.join(tmp, 'proyecto');
  fueraDelProyecto = path.join(tmp, 'privado');
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(fueraDelProyecto, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.ts'), 'export const a = 1\n');
  fs.writeFileSync(path.join(fueraDelProyecto, 'secreto.txt'), 'no deberia leerse\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// -- réplicas de los handlers, con el mismo guardado que main.js -------------

function leer(root: string | null, filePath: string): string {
  try {
    return fs.readFileSync(resolveInsideRoot(root, filePath), 'utf-8');
  } catch {
    return '';
  }
}

function crear(root: string | null, basePath: string, name: string, content: string) {
  try {
    if (!isSafeFileName(name)) throw new Error('nombre no valido');
    const base = resolveInsideRoot(root, basePath);
    const full = resolveInsideRoot(base, name);
    fs.writeFileSync(full, content, 'utf-8');
    return { success: true, path: full };
  } catch {
    return { success: false as const };
  }
}

function guardar(root: string | null, filePath: string, content: string): boolean {
  try {
    fs.writeFileSync(resolveInsideRoot(root, filePath), content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function borrar(root: string | null, filePath: string): boolean {
  try {
    const safe = resolveInsideRoot(root, filePath);
    if (safe === path.resolve(root as string)) throw new Error('es la raiz');
    const stat = fs.statSync(safe);
    if (stat.isDirectory()) fs.rmSync(safe, { recursive: true, force: true });
    else fs.unlinkSync(safe);
    return true;
  } catch {
    return false;
  }
}

// -- lo que sí debe seguir funcionando ---------------------------------------

describe('operaciones legítimas dentro del proyecto', () => {
  it('lee un fichero del proyecto', () => {
    expect(leer(projectRoot, path.join(projectRoot, 'src', 'index.ts'))).toContain('export const a');
  });

  it('crea un fichero nuevo', () => {
    const res = crear(projectRoot, path.join(projectRoot, 'src'), 'nuevo.ts', 'hola');
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'src', 'nuevo.ts'), 'utf-8')).toBe('hola');
  });

  it('guarda cambios en un fichero existente', () => {
    const objetivo = path.join(projectRoot, 'src', 'index.ts');
    expect(guardar(projectRoot, objetivo, 'cambiado')).toBe(true);
    expect(fs.readFileSync(objetivo, 'utf-8')).toBe('cambiado');
  });

  it('borra un fichero del proyecto', () => {
    const objetivo = path.join(projectRoot, 'src', 'index.ts');
    expect(borrar(projectRoot, objetivo)).toBe(true);
    expect(fs.existsSync(objetivo)).toBe(false);
  });
});

// -- lo que debe quedar bloqueado --------------------------------------------

describe('escapes del proyecto', () => {
  it('no lee un fichero de fuera por ruta absoluta', () => {
    expect(leer(projectRoot, path.join(fueraDelProyecto, 'secreto.txt'))).toBe('');
  });

  it('no lee un fichero de fuera subiendo con ..', () => {
    expect(leer(projectRoot, path.join(projectRoot, '..', 'privado', 'secreto.txt'))).toBe('');
  });

  it('no crea ficheros fuera usando .. en el nombre', () => {
    const res = crear(projectRoot, path.join(projectRoot, 'src'), '../../privado/inyectado.txt', 'x');
    expect(res.success).toBe(false);
    expect(fs.existsSync(path.join(fueraDelProyecto, 'inyectado.txt'))).toBe(false);
  });

  it('no crea ficheros fuera usando un basePath ajeno', () => {
    const res = crear(projectRoot, fueraDelProyecto, 'inyectado.txt', 'x');
    expect(res.success).toBe(false);
    expect(fs.existsSync(path.join(fueraDelProyecto, 'inyectado.txt'))).toBe(false);
  });

  it('no sobrescribe un fichero de fuera', () => {
    const victima = path.join(fueraDelProyecto, 'secreto.txt');
    expect(guardar(projectRoot, victima, 'PISADO')).toBe(false);
    expect(fs.readFileSync(victima, 'utf-8')).toContain('no deberia leerse');
  });

  it('no borra nada de fuera', () => {
    const victima = path.join(fueraDelProyecto, 'secreto.txt');
    expect(borrar(projectRoot, victima)).toBe(false);
    expect(fs.existsSync(victima)).toBe(true);
  });

  it('no borra la raíz del proyecto', () => {
    expect(borrar(projectRoot, projectRoot)).toBe(false);
    expect(fs.existsSync(projectRoot)).toBe(true);
  });

  it('no toca nada si no hay proyecto abierto', () => {
    const victima = path.join(fueraDelProyecto, 'secreto.txt');
    expect(leer(null, victima)).toBe('');
    expect(guardar(null, victima, 'PISADO')).toBe(false);
    expect(borrar(null, victima)).toBe(false);
    expect(fs.readFileSync(victima, 'utf-8')).toContain('no deberia leerse');
  });
});

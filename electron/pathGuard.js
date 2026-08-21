import path from 'path';
import fs from 'fs';

/**
 * Confinamiento de rutas para los handlers de ficheros.
 *
 * Los handlers de fs reciben rutas desde el renderer y las pasaban tal cual a
 * fs.promises. Nada comprobaba que apuntaran dentro del proyecto abierto, así
 * que un nombre como "../../../algo" escribía fuera, y fs:readFile podía leer
 * cualquier fichero del disco. En un IDE eso importa: parte de lo que llega a
 * estos handlers lo propone el modelo de IA, no el usuario tecleando.
 *
 * La regla es una sola: toda operación se resuelve contra la raíz del proyecto
 * abierto y se rechaza si el resultado cae fuera.
 */

/** Normaliza para comparar: resuelve y quita la barra final. */
function normalize(p) {
  const resolved = path.resolve(p);
  return resolved.length > 1 && resolved.endsWith(path.sep)
    ? resolved.slice(0, -1)
    : resolved;
}

/**
 * ¿`target` está dentro de `root` (o es la propia raíz)?
 * Compara ruta a ruta, no por prefijo de texto: "/proyecto-malo" no cuenta
 * como dentro de "/proyecto".
 */
export function isInsideRoot(root, target) {
  if (!root || !target) return false;

  const rootAbs = normalize(root);
  const targetAbs = normalize(target);

  if (targetAbs === rootAbs) return true;

  const rel = path.relative(rootAbs, targetAbs);
  // Si hay que subir, o el relativo es absoluto (otra unidad en Windows),
  // el destino está fuera.
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resuelve `segments` contra `root` y devuelve la ruta absoluta, o lanza si
 * se sale. Usar en todo handler que vaya a tocar el disco.
 */
export function resolveInsideRoot(root, ...segments) {
  if (!root) {
    throw new Error('No hay proyecto abierto: abre una carpeta antes de operar con ficheros.');
  }
  const candidate = path.resolve(root, ...segments);
  if (!isInsideRoot(root, candidate)) {
    throw new Error(`Ruta fuera del proyecto: ${path.join(...segments)}`);
  }
  return candidate;
}

/**
 * Resuelve una ruta que ya existe y compara sus rutas físicas. Esto impide
 * que un symlink/junction ubicado dentro del proyecto redirija la operación a
 * otro lugar del disco.
 */
export function resolveExistingInsideRoot(root, ...segments) {
  if (!root) {
    throw new Error('No hay proyecto abierto: abre una carpeta antes de operar con ficheros.');
  }

  const rootReal = fs.realpathSync(root);
  const candidate = resolveInsideRoot(root, ...segments);
  const candidateReal = fs.realpathSync(candidate);

  if (!isInsideRoot(rootReal, candidateReal)) {
    throw new Error(`Ruta fuera del proyecto: ${path.join(...segments)}`);
  }

  return candidateReal;
}

function assertNoLinksBelowRoot(root, candidate) {
  const rootAbs = normalize(root);
  const candidateAbs = normalize(candidate);
  const relative = path.relative(rootAbs, candidateAbs);
  if (relative === '') return;

  let current = rootAbs;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`No se permiten enlaces simbólicos en operaciones de escritura: ${current}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

/**
 * Valida físicamente una ruta existente para escritura/borrado, rechaza
 * enlaces bajo la raíz y conserva la entrada lexical solicitada. Conservarla
 * evita que rename/rm actúen accidentalmente sobre el destino de un enlace.
 */
export function resolveMutableExistingInsideRoot(root, ...segments) {
  const candidate = resolveInsideRoot(root, ...segments);
  resolveExistingInsideRoot(root, ...segments);
  assertNoLinksBelowRoot(root, candidate);
  return candidate;
}

/**
 * Resuelve un destino nuevo dentro de un directorio físico ya validado. Si el
 * destino existe, también valida su ruta real para no seguir enlaces externos.
 */
export function resolveNewInsideRoot(root, basePath, name) {
  if (!root) {
    throw new Error('No hay proyecto abierto: abre una carpeta antes de operar con ficheros.');
  }
  const rootReal = fs.realpathSync(root);
  const basePathSafe = resolveMutableExistingInsideRoot(root, basePath);
  const baseReal = fs.realpathSync(basePathSafe);

  if (!fs.statSync(baseReal).isDirectory()) {
    throw new Error('La ruta base no es una carpeta.');
  }

  const candidate = path.resolve(basePathSafe, name);
  if (!isInsideRoot(root, candidate)) {
    throw new Error(`Ruta fuera del proyecto: ${name}`);
  }

  let candidateStat = null;
  try {
    candidateStat = fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (candidateStat?.isSymbolicLink()) {
    throw new Error(`No se permiten enlaces simbólicos en operaciones de escritura: ${candidate}`);
  }

  assertNoLinksBelowRoot(root, candidate);

  if (candidateStat) {
    const candidateReal = fs.realpathSync(candidate);
    if (!isInsideRoot(rootReal, candidateReal)) {
      throw new Error(`Ruta fuera del proyecto: ${name}`);
    }
    return candidate;
  }

  return candidate;
}

/**
 * Convierte rutas recibidas por los handlers Git en pathspecs relativos y
 * confinados. El separador `--` debe añadirse al invocar Git para evitar que
 * un nombre de fichero pueda interpretarse como opción.
 */
export function normalizeGitPathspecs(projectPath, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Se requiere al menos una ruta de fichero.');
  }

  return files.map((file) => {
    if (typeof file !== 'string' || file.trim() === '' || file.includes('\0')) {
      throw new Error('Ruta Git no válida.');
    }

    const absolute = resolveInsideRoot(projectPath, file);
    if (fs.existsSync(absolute)) {
      // Valida el destino físico, pero conserva el pathspec original para Git.
      resolveExistingInsideRoot(projectPath, file);
    }
    const relative = path.relative(projectPath, absolute);
    if (relative === '') return '.';
    return `:(literal)${relative.split(path.sep).join('/')}`;
  });
}

/**
 * Nombres de fichero que nunca deben aceptarse desde el renderer, ni siquiera
 * antes de resolver: separadores de ruta, referencias relativas y vacíos.
 */
export function isSafeFileName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  if (trimmed.includes('\0')) return false;
  return true;
}

/**
 * Valida el directorio inicial de la terminal contra la raíz elegida por el
 * usuario. `realpathSync` evita que un junction o symlink interno apunte fuera.
 * Esto protege el arranque; la shell sigue siendo una terminal real y no un
 * sandbox del sistema operativo.
 */
export function resolveTerminalCwd(root, requestedCwd = root) {
  if (!root) {
    throw new Error('No hay proyecto abierto: abre una carpeta antes de iniciar la terminal.');
  }

  const rootReal = fs.realpathSync(root);
  const requestedReal = resolveExistingInsideRoot(root, requestedCwd || root);

  if (!fs.statSync(requestedReal).isDirectory()) {
    throw new Error('El directorio solicitado para la terminal no es una carpeta.');
  }
  if (!isInsideRoot(rootReal, requestedReal)) {
    throw new Error('Ruta fuera del proyecto: directorio de terminal no permitido.');
  }

  return requestedReal;
}

import path from 'path';

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

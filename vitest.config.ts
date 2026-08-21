import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // electron/ también: el proceso principal tiene lógica propia (confinamiento
    // de rutas) que conviene probar sin levantar Electron entero.
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});

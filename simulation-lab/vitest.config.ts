import { defineConfig } from 'vitest/config';

/**
 * Environnement `node`, jamais `jsdom`.
 *
 * Ce n'est pas une préférence : la simulation n'a aucune dépendance au
 * navigateur, et c'est une propriété qu'on veut voir se casser en test le
 * jour où quelqu'un importe le DOM dedans. Un banc d'essai qui a besoin
 * d'un écran pour tourner ne sert plus à rien.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
});

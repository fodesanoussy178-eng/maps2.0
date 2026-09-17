import { defineConfig } from 'vitest/config';

/**
 * Configuration de test du jeu, séparée de celle d'Urosi-t.
 *
 * Environnement `node` et non `jsdom` : le noyau et les moteurs n'ont aucune
 * dépendance au navigateur, et c'est une propriété qu'on veut voir se casser
 * en test le jour où quelqu'un importe le DOM dans la simulation.
 */
export default defineConfig({
  test: {
    root: __dirname,
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});

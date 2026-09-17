/**
 * Le noyau.
 *
 * Temps, aléa, bus d'événements, échelles, empreinte. Aucune règle de jeu :
 * le noyau ignore qu'il existe des personnages. C'est ce qui lui permet de ne
 * pratiquement plus changer — et c'est nécessaire, car changer le noyau (le
 * générateur d'aléa en particulier) modifie l'avenir de toutes les parties
 * déjà commencées.
 */

export * from './ids.ts';
export * from './alea.ts';
export * from './temps.ts';
export * from './evenements.ts';
export * from './echelles.ts';
export * from './empreinte.ts';

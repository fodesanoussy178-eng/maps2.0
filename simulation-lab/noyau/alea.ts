/**
 * Aléa déterministe.
 *
 * `Math.random` est interdit partout dans `jeu/noyau` et `jeu/moteurs`. Une
 * partie doit pouvoir être rejouée à l'identique à partir de sa graine et du
 * journal des entrées du joueur — c'est la condition pour déboguer une
 * simulation qui tourne sur des décennies.
 *
 * Deux briques :
 *
 *   - `sfc32`, un générateur à quatre mots de 32 bits. Rapide, de bonne
 *     qualité statistique, et surtout : son état tient en quatre entiers,
 *     donc il se sérialise dans la sauvegarde sans cérémonie.
 *
 *   - `hacher`, un mélangeur qui fabrique une graine à partir d'une liste de
 *     clés (nom du flux, identifiant, tick).
 *
 * Le point important n'est pas le générateur, c'est le FLUX NOMMÉ. Un
 * générateur global unique lierait tous les systèmes entre eux : ajouter un
 * tirage quelque part décalerait toute la suite ailleurs, et deux versions du
 * code ne produiraient plus jamais la même partie. En dérivant un générateur
 * par (flux, entité, tick), chaque décision tire dans son propre univers.
 *
 *   const r = creerFlux(monde.graine, 'decision', persoId, monde.tick);
 *
 * Conséquence pratique : on peut rejouer la décision d'un seul personnage,
 * isolément et hors ordre, et obtenir exactement ce qu'a produit la partie
 * complète. C'est l'outil de débogage le plus utile du projet.
 */

export interface Alea {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Mélangeur d'avalanche 32 bits (splitmix32). Sert à semer et à hacher. */
function melanger32(graine: number): number {
  let x = (graine + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * Combine des clés en une graine unique. Les chaînes sont absorbées caractère
 * par caractère (FNV-1a), les nombres sont mélangés directement. Deux listes
 * de clés différentes donnent des graines différentes avec une probabilité
 * écrasante — ce qui suffit ici : une collision ne corromprait rien, elle
 * corrélerait seulement deux tirages sans rapport.
 */
export function hacher(...cles: readonly (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const cle of cles) {
    if (typeof cle === 'number') {
      h = melanger32(h ^ (cle | 0));
    } else {
      for (let i = 0; i < cle.length; i += 1) {
        h = Math.imul(h ^ cle.charCodeAt(i), 0x01000193) >>> 0;
      }
      h = melanger32(h);
    }
  }
  return h >>> 0;
}

/** Crée un générateur à partir d'une graine brute. */
export function creerAlea(graine: number): Alea {
  const etat: Alea = {
    a: melanger32(graine),
    b: melanger32(graine ^ 0x9e3779b9),
    c: melanger32(graine ^ 0x85ebca6b),
    d: melanger32(graine ^ 0xc2b2ae35),
  };
  // Quelques tours à vide : sans cela, deux graines voisines produisent des
  // premiers tirages voisins, ce qui se verrait immédiatement sur des
  // personnages aux identifiants consécutifs.
  for (let i = 0; i < 8; i += 1) suivant(etat);
  return etat;
}

/**
 * Crée un flux nommé. C'est la fonction à utiliser partout ailleurs : elle
 * dérive un générateur indépendant pour un usage, une entité et un instant.
 */
export function creerFlux(
  graineRacine: number,
  flux: string,
  ...cles: readonly (number | string)[]
): Alea {
  return creerAlea(hacher(graineRacine, flux, ...cles));
}

/** Entier non signé sur 32 bits. Toutes les autres fonctions passent par là. */
export function suivant(r: Alea): number {
  const t = (((r.a + r.b) | 0) + r.d) | 0;
  r.d = (r.d + 1) | 0;
  r.a = r.b ^ (r.b >>> 9);
  r.b = (r.c + (r.c << 3)) | 0;
  r.c = (r.c << 21) | (r.c >>> 11);
  r.c = (r.c + t) | 0;
  return t >>> 0;
}

/** Flottant dans [0, 1). Réservé aux calculs de probabilité, jamais à l'état. */
export function flottant(r: Alea): number {
  return suivant(r) / 4294967296;
}

/** Entier dans [min, maxExclu). Renvoie `min` si l'intervalle est vide. */
export function entier(r: Alea, min: number, maxExclu: number): number {
  const etendue = maxExclu - min;
  if (etendue <= 0) return min;
  return min + (suivant(r) % etendue);
}

/** Vrai avec la probabilité donnée (0..1). */
export function chance(r: Alea, probabilite: number): boolean {
  return flottant(r) < probabilite;
}

/** Un élément au hasard. `undefined` seulement si le tableau est vide. */
export function choisir<T>(r: Alea, elements: readonly T[]): T | undefined {
  if (elements.length === 0) return undefined;
  return elements[entier(r, 0, elements.length)];
}

/**
 * Tirage pondéré. C'est la primitive de décision du jeu : l'IA d'utilité
 * produit des scores, et c'est ici qu'ils deviennent un choix. Un poids nul
 * ou négatif rend l'option impossible, jamais improbable.
 */
export function choisirPondere<T>(
  r: Alea,
  elements: readonly T[],
  poids: readonly number[],
): T | undefined {
  let total = 0;
  for (let i = 0; i < elements.length; i += 1) {
    const p = poids[i] ?? 0;
    if (p > 0) total += p;
  }
  if (total <= 0) return undefined;

  let seuil = flottant(r) * total;
  for (let i = 0; i < elements.length; i += 1) {
    const p = poids[i] ?? 0;
    if (p <= 0) continue;
    seuil -= p;
    if (seuil <= 0) return elements[i];
  }
  // Atteignable uniquement par arrondi flottant sur la dernière option.
  return elements[elements.length - 1];
}

/** Mélange une copie du tableau (Fisher-Yates). L'original n'est pas touché. */
export function melangerTableau<T>(r: Alea, elements: readonly T[]): T[] {
  const copie = elements.slice();
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = entier(r, 0, i + 1);
    const ci = copie[i];
    const cj = copie[j];
    if (ci === undefined || cj === undefined) continue;
    copie[i] = cj;
    copie[j] = ci;
  }
  return copie;
}

/**
 * Loi normale (Box-Muller). Utilisée pour l'hérédité des traits, les tailles,
 * les variations de revenus : tout ce qui doit se concentrer autour d'une
 * moyenne au lieu d'être uniformément réparti. Le résultat est borné à
 * ±4 écarts-types pour qu'aucune queue de distribution ne produise un
 * personnage de trois mètres.
 */
export function normal(r: Alea, moyenne: number, ecartType: number): number {
  const u1 = Math.max(flottant(r), 1e-9);
  const u2 = flottant(r);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return moyenne + ecartType * Math.max(-4, Math.min(4, z));
}

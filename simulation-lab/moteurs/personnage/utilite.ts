/**
 * L'IA d'utilité.
 *
 * Choisie plutôt qu'un arbre de comportement — trop rigide, scripté par
 * nature, et qui produit cent habitants faisant tous la même chose — ou qu'un
 * GOAP, trop coûteux et surtout trop rationnel : un planificateur optimal
 * fabrique des agents qui ne se trompent jamais, ce qui est l'inverse de ce
 * qu'on cherche.
 *
 * Deux mécanismes, et le second est celui qui compte vraiment.
 */

import type { Alea } from '../../noyau/index.ts';
import { choisirPondere, flottant } from '../../noyau/index.ts';
import type { Personnage } from '../../etat/personnage.ts';
import { traitNormalise } from '../../etat/personnage.ts';
import type { Action, Contexte } from './actions.ts';

export interface Evaluation {
  action: Action;
  score: number;
}

/**
 * Score d'une action : le PRODUIT de ses considérations.
 *
 * Le produit, et non la moyenne, parce qu'une considération nulle doit
 * annuler l'action — manger au café quand le café est fermé ne doit pas
 * rester « moyennement intéressant ».
 *
 * Mais le produit pénalise mécaniquement les actions à nombreuses
 * considérations : cinq valeurs de 0,8 donnent 0,33 là où deux donnent 0,64,
 * sans que la seconde soit plus désirable. D'où la COMPENSATION : on corrige
 * le score vers le haut d'autant plus que les critères sont nombreux. Sans
 * elle, il devient impossible de décrire finement une action sans la
 * désavantager, et le catalogue dérive vers des actions simplistes.
 */
export function evaluer(action: Action, ctx: Contexte): number {
  const n = action.considerations.length;
  if (n === 0) return 0;

  let produit = 1;
  for (const consideration of action.considerations) {
    const v = consideration(ctx);
    if (v <= 0) return 0;
    produit *= v > 1 ? 1 : v;
  }

  const compensation = (1 - 1 / n) * (1 - produit);
  return produit + compensation * produit;
}

/**
 * Exposant du tirage, dérivé de l'impulsivité et de la prudence.
 *
 * C'EST ICI que la personnalité devient du comportement, et c'est la réponse
 * au §22 du cahier des charges : « un personnage prudent ne doit pas avoir
 * exactement les mêmes probabilités comportementales qu'un personnage
 * extrêmement impulsif ».
 *
 * Les scores sont élevés à cette puissance avant le tirage. Un exposant élevé
 * écrase les options moyennes : le personnage prend presque toujours la
 * meilleure. Un exposant bas aplatit la distribution : il s'écarte souvent,
 * parfois pour une option nettement moins bonne. Les deux voient le même
 * monde et calculent les mêmes utilités — seule leur façon de trancher
 * diffère, ce qui est précisément ce qu'est un tempérament.
 */
export function exposant(p: Personnage): number {
  const impulsif = traitNormalise(p, 'impulsivite');
  const prudent = traitNormalise(p, 'prudence');
  return 1.2 + 7 * (1 - impulsif) * (0.4 + 0.6 * prudent);
}

export interface Decision {
  action: Action;
  score: number;
  /** Les meilleures options considérées, pour l'inspecteur du labo. */
  candidats: Evaluation[];
}

/**
 * Évalue toutes les actions et en choisit une.
 *
 * Seules les `largeur` meilleures entrent dans le tirage : au-delà, on
 * mélangerait du bruit — un personnage qui part à la salle de sport à 3 h du
 * matin parce que la dixième option a gagné une loterie n'est pas
 * imprévisible, il est cassé.
 */
export function decider(
  actions: readonly Action[],
  contexte: (action: Action) => Contexte,
  perso: Personnage,
  alea: Alea,
  largeur = 4,
): Decision | null {
  const evaluations: Evaluation[] = [];
  for (const action of actions) {
    const score = evaluer(action, contexte(action));
    if (score > 0) evaluations.push({ action, score });
  }
  if (evaluations.length === 0) return null;

  // Tri total : le score départage, puis l'identifiant. Sans ce second
  // critère, deux actions à score égal s'ordonneraient selon l'implémentation
  // du tri, et le rejeu déterministe ne tiendrait plus.
  evaluations.sort((a, b) => b.score - a.score || (a.action.id < b.action.id ? -1 : 1));

  const candidats = evaluations.slice(0, largeur);
  const e = exposant(perso);
  const poids = candidats.map((c) => Math.pow(c.score, e));

  const choix = choisirPondere(alea, candidats, poids) ?? candidats[0];
  if (choix === undefined) return null;
  return { action: choix.action, score: choix.score, candidats };
}

/**
 * Part des tirages remportés par la meilleure option, pour un personnage
 * donné. Sert au banc d'essai : c'est la mesure directe de son tempérament
 * décisionnel, et elle doit séparer nettement un prudent d'un impulsif.
 */
export function tauxOptimalite(
  perso: Personnage,
  scores: readonly number[],
  alea: Alea,
  tirages = 2000,
): number {
  if (scores.length === 0) return 1;
  const e = exposant(perso);
  const poids = scores.map((s) => Math.pow(s, e));
  const total = poids.reduce((a, b) => a + b, 0);
  if (total <= 0) return 1;

  const meilleur = Math.max(...scores);
  let gagnes = 0;
  for (let i = 0; i < tirages; i += 1) {
    let seuil = flottant(alea) * total;
    for (let j = 0; j < poids.length; j += 1) {
      seuil -= poids[j] ?? 0;
      if (seuil <= 0) {
        if ((scores[j] ?? 0) === meilleur) gagnes += 1;
        break;
      }
    }
  }
  return gagnes / tirages;
}

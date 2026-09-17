/**
 * La boucle de simulation.
 *
 * Elle orchestre, elle ne décide pas : elle fait avancer le temps, réveille
 * les personnages dus à leur échelle, replie le temps écoulé depuis leur
 * dernière mise à jour et applique ce que le moteur de décision a choisi.
 * Toute règle de comportement qui s'écrirait ici serait au mauvais endroit.
 *
 * Le point délicat est le REPLI. Un personnage à l'échelle horaire n'est
 * réveillé qu'une fois toutes les douze ticks ; il faut alors rejouer douze
 * ticks d'un coup et obtenir le même état que s'ils avaient été simulés un
 * par un. C'est possible parce que la dérive des besoins et les effets des
 * actions sont linéaires dans le temps — une propriété qu'il faut préserver
 * dans tout ce qu'on ajoutera, sans quoi changer l'échelle d'un personnage
 * changerait sa vie.
 */

import type { LieuId, PersoId } from '../noyau/index.ts';
import { creerFlux, doitMettreAJour, hacher, heureDecimale } from '../noyau/index.ts';
import type { Monde } from '../etat/monde.ts';
import { autresPresents, domicile, posteDe } from '../etat/monde.ts';
import type { Besoin, Personnage } from '../etat/personnage.ts';
import { ajouterBesoin } from '../etat/personnage.ts';
import type { Action, Contexte } from '../moteurs/personnage/actions.ts';
import { CATALOGUE, action as actionParId } from '../moteurs/personnage/actions.ts';
import { deriver } from '../moteurs/personnage/besoins.ts';
import { decider } from '../moteurs/personnage/utilite.ts';
import { DUREE_TRAJET, estOuvert, estPlein } from '../etat/lieu.ts';
import { crediter, depenserFoyer, deplacer } from '../etat/transactions.ts';
import type { Poste } from '../etat/poste.ts';

/**
 * Le banc d'essai observe la simulation de l'extérieur : aucune métrique
 * n'est stockée dans le monde. Une statistique rangée dans l'état est une
 * statistique qu'il faudra sauvegarder, migrer et tenir cohérente pour rien.
 */
export interface Observateur {
  surActivite?: (monde: Monde, p: Personnage, activite: string, ticks: number) => void;
  surInteraction?: (monde: Monde, p: Personnage, interlocuteurs: number) => void;
  surDecision?: (monde: Monde, p: Personnage, choisie: string, meilleure: string) => void;
  surEchec?: (monde: Monde, p: Personnage, raison: string) => void;
  /**
   * Un réveil : une exécution de la mise à jour d'un personnage. C'est LA
   * mesure du coût des échelles de simulation — et non le nombre de
   * décisions, qui dépend de la durée des activités et bouge à peine.
   */
  surReveil?: (monde: Monde, p: Personnage, ticksReplies: number) => void;
}

export interface OptionsBoucle {
  observateur?: Observateur;
  /** Garde-fou : nombre maximum d'enchaînements d'activités par réveil. */
  enchainementsMax?: number;
}

/**
 * Où réaliser une action. Renvoie `null` si aucun lieu n'est possible.
 *
 * Les actions « logement » visent le DOMICILE du personnage, pas n'importe
 * quel logement : sans cette distinction, les habitants iraient dormir chez
 * le premier voisin venu, ce qui passe tous les tests et ruine la
 * crédibilité.
 */
export function lieuCible(monde: Monde, p: Personnage, a: Action): LieuId | null {
  if (a.lieux.length === 0) return p.position.lieu;

  const heure = heureDecimale(monde.tick);
  const courant = monde.lieux.get(p.position.lieu);

  if (a.lieux.includes('logement')) return domicile(monde, p);

  // Le travail et les études ont un lieu attitré : on ne va pas travailler
  // dans le bureau d'à côté parce qu'il est plus proche.
  const poste = posteDe(monde, p);
  if (poste !== undefined) {
    const attitre = monde.lieux.get(poste.lieu);
    if (attitre !== undefined && a.lieux.includes(attitre.type)) return attitre.id;
  }

  if (courant !== undefined && a.lieux.includes(courant.type) && estOuvert(courant, heure)) {
    return courant.id;
  }

  // Parmi les lieux possibles, une PRÉFÉRENCE stable par personne.
  //
  // La première version renvoyait le premier lieu trouvé, c'est-à-dire le
  // premier inséré dans la Map. Conséquence, invisible dans les moyennes et
  // flagrante dès qu'on regarde la ville : tout le monde allait au même café,
  // personne n'entrait jamais dans le second, et « faire du sport » envoyait
  // les soixante habitants au gymnase parce qu'il précédait le parc. La
  // moitié des lieux du monde ne servaient à rien.
  //
  // Le hachage donne à chacun ses habitudes — son café, son parc — sans rien
  // stocker et sans casser le rejeu déterministe.
  let choix: LieuId | null = null;
  let meilleur = -1;
  for (const l of monde.lieux.values()) {
    if (!a.lieux.includes(l.type)) continue;
    if (!estOuvert(l, heure)) continue;
    if (estPlein(l) && l.id !== p.position.lieu) continue;
    const score = hacher('lieu-prefere', p.id as number, l.id as number) % 1000;
    if (score > meilleur) { meilleur = score; choix = l.id; }
  }
  return choix;
}

/**
 * Argent mobilisable par le foyer, calculé une fois par décision.
 *
 * Passé d'un parcours de toute la population à un parcours des seuls membres
 * du foyer : c'est l'intérêt direct de l'entité `Foyer`, et le premier goulet
 * d'étranglement de l'audit qui disparaît.
 */
function argentDuFoyer(monde: Monde, p: Personnage): number {
  let total = 0;
  for (const id of monde.foyers.get(p.foyer)?.membres ?? []) {
    total += Math.max(0, monde.personnages.get(id)?.argent ?? 0);
  }
  return total;
}

function contextePour(
  monde: Monde,
  p: Personnage,
  presents: number,
): (a: Action) => Contexte {
  const heure = heureDecimale(monde.tick);
  const argentFoyer = argentDuFoyer(monde, p);
  return (a: Action): Contexte => {
    const cible = lieuCible(monde, p, a);
    return {
      monde,
      perso: p,
      heure,
      presents,
      surPlace: cible !== null && cible === p.position.lieu,
      accessible: cible !== null,
      argentFoyer,
    };
  };
}

/** Applique les effets d'une action sur `ticks` ticks. Linéaire, donc repliable. */
function appliquerEffets(p: Personnage, a: Action, ticks: number, poste: Poste | undefined): void {
  if (ticks <= 0) return;
  for (const [nom, valeur] of Object.entries(a.effets)) {
    ajouterBesoin(p, nom as Besoin, valeur * ticks);
  }
  if (a.id === 'travailler' && poste !== undefined && poste.genre === 'emploi') {
    crediter(p, Math.round((poste.salaireHoraire * ticks) / 12));
  }
}

/** Réveille un personnage et rattrape le temps écoulé depuis sa dernière mise à jour. */
function mettreAJour(monde: Monde, p: Personnage, options: OptionsBoucle): void {
  const maintenant = monde.tick;
  const ecoule = maintenant - p.derniereMaj;
  if (ecoule <= 0) return;

  options.observateur?.surReveil?.(monde, p, ecoule);
  deriver(p, ecoule);

  const enchainementsMax = options.enchainementsMax ?? 32;

  let t = p.derniereMaj;
  let enchainements = 0;

  while (t < maintenant && enchainements < enchainementsMax) {
    enchainements += 1;

    const activite = p.activite;
    if (activite !== null) {
      const fin = Math.min(activite.jusqua, maintenant);
      const duree = fin - t;

      if (activite.type === 'action') {
        const a = actionParId(activite.action);
        if (a !== undefined) {
          appliquerEffets(p, a, duree, posteDe(monde, p));
          options.observateur?.surActivite?.(monde, p, a.id, duree);
        }
      } else if (duree > 0) {
        options.observateur?.surActivite?.(monde, p, 'se_deplacer', duree);
      }

      t = fin;
      if (activite.jusqua > maintenant) break;

      // L'activité s'achève : un déplacement dépose son voyageur.
      if (activite.type === 'deplacement') {
        const resultat = deplacer(monde, p, activite.vers);
        if (!resultat.ok) options.observateur?.surEchec?.(monde, p, resultat.raison);
      }
      p.activite = null;
      continue;
    }

    if (!engager(monde, p, t, options)) break;
  }

  p.derniereMaj = maintenant;
}

/**
 * Choisit une activité et la démarre. Renvoie `false` si rien n'a pu être
 * engagé — ce qui ne doit jamais arriver, puisque « flâner » est toujours
 * possible, mais la boucle ne parie pas là-dessus.
 */
function engager(
  monde: Monde,
  p: Personnage,
  t: number,
  options: OptionsBoucle,
): boolean {
  // Recalculé à chaque décision et non une fois au réveil : après un
  // déplacement, le nombre de personnes autour a changé, et c'est
  // précisément ce qui doit rendre « discuter » désirable en arrivant
  // quelque part.
  const presents = autresPresents(monde, p.id).length;
  const alea = creerFlux(monde.graine, 'decision', p.id, t);
  const decision = decider(CATALOGUE, contextePour(monde, p, presents), p, alea);
  if (decision === null) return false;

  const meilleure = decision.candidats[0]?.action.id ?? decision.action.id;
  options.observateur?.surDecision?.(monde, p, decision.action.id, meilleure);

  const cible = lieuCible(monde, p, decision.action);
  if (cible === null) return false;

  if (cible !== p.position.lieu) {
    p.activite = { type: 'deplacement', vers: cible, jusqua: t + DUREE_TRAJET };
    return true;
  }

  if (decision.action.cout > 0) {
    const paiement = depenserFoyer(monde, p, decision.action.cout);
    if (!paiement.ok) {
      // Ne pas avoir les moyens est un fait ordinaire du monde, pas une
      // erreur : on flâne un quart d'heure plutôt que de boucler sur une
      // action inaccessible.
      options.observateur?.surEchec?.(monde, p, paiement.raison);
      p.activite = { type: 'action', action: 'flaner', jusqua: t + 3 };
      return true;
    }
  }

  if (decision.action.sociale && presents > 0) {
    options.observateur?.surInteraction?.(monde, p, presents);
  }

  p.activite = { type: 'action', action: decision.action.id, jusqua: t + decision.action.duree };
  return true;
}

/**
 * Avance la simulation de `ticks` pas.
 *
 * L'itération se fait sur `monde.personnages` dans l'ordre d'insertion,
 * garanti par la spécification des `Map`. C'est ce qui rend la boucle
 * rejouable : un ordre dépendant du ramasse-miettes ou d'un tri instable
 * suffirait à faire diverger deux parties issues de la même graine.
 */
export function avancer(monde: Monde, ticks: number, options: OptionsBoucle = {}): void {
  for (let i = 0; i < ticks; i += 1) {
    monde.tick += 1;
    for (const p of monde.personnages.values()) {
      if (!doitMettreAJour(p.echelle, p.id as number, monde.tick)) continue;
      mettreAJour(monde, p, options);
    }
  }
}

/**
 * Force la mise à jour d'un personnage précis : c'est le rattrapage paresseux
 * du §27, celui qu'on déclenchera quand le joueur adressera la parole à
 * quelqu'un qu'on n'a pas calculé depuis trois jours.
 */
export function rattraperMaintenant(
  monde: Monde,
  id: PersoId,
  options: OptionsBoucle = {},
): void {
  const p = monde.personnages.get(id);
  if (p !== undefined) mettreAJour(monde, p, options);
}

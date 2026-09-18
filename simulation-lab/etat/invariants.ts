/**
 * Le vérificateur d'invariants.
 *
 * Il contrôle ce qui ne doit jamais être faux, et il tourne à chaque tick en
 * test. C'est le seul dispositif qui attrape une incohérence à l'instant où
 * elle naît, plutôt que trois mille ticks plus tard, quand plus rien ne
 * permet de remonter à sa cause.
 *
 * Il ne tourne pas en production : son coût est linéaire en population et en
 * lieux, ce qui est négligeable pour cent habitants mais inutile une fois les
 * systèmes stabilisés.
 */

import { TICKS_PAR_AN } from '../noyau/index.ts';
import type { Monde } from './monde.ts';
import { BESOINS, BESOIN_MAX, besoin } from './personnage.ts';
import { TRAITS, trait } from './personnage.ts';

export interface Violation {
  regle: string;
  detail: string;
}

export function verifierInvariants(monde: Monde): Violation[] {
  const violations: Violation[] = [];
  const signaler = (regle: string, detail: string): void => {
    violations.push({ regle, detail });
  };

  // --- Les personnages ------------------------------------------------------
  for (const p of monde.personnages.values()) {
    const ou = `${p.prenom} ${p.nom} (#${p.id})`;

    const lieu = monde.lieux.get(p.lieu);
    if (lieu === undefined) {
      signaler('lieu-existe', `${ou} se trouve dans le lieu inconnu #${p.lieu}`);
    } else if (!lieu.occupants.includes(p.id)) {
      // L'invariant le plus important : le lien position ↔ occupants est
      // bidirectionnel. C'est celui que casse une écriture directe.
      signaler('presence-reciproque', `${ou} est dans « ${lieu.nom} » sans y figurer`);
    }

    for (const b of BESOINS) {
      const v = besoin(p, b);
      if (!Number.isFinite(v) || v < 0 || v > BESOIN_MAX) {
        signaler('besoin-borne', `${ou} a ${b} = ${v}, hors de [0, ${BESOIN_MAX}]`);
      }
    }
    if (p.besoins.length !== BESOINS.length) {
      signaler('besoin-cardinal', `${ou} a ${p.besoins.length} besoins au lieu de ${BESOINS.length}`);
    }

    for (const t of TRAITS) {
      const v = trait(p, t);
      if (!Number.isFinite(v) || v < -100 || v > 100) {
        signaler('trait-borne', `${ou} a ${t} = ${v}, hors de [-100, 100]`);
      }
    }

    if (!Number.isFinite(p.argent)) {
      signaler('argent-fini', `${ou} a un argent non fini`);
    }

    if (p.naissance > monde.tick) {
      signaler('naissance-passee', `${ou} naît au tick ${p.naissance}, après maintenant`);
    }
    if (monde.tick - p.naissance > 130 * TICKS_PAR_AN) {
      signaler('age-plausible', `${ou} a plus de 130 ans`);
    }

    // La comparaison se fait avec la DERNIÈRE MISE À JOUR du personnage, pas
    // avec l'heure du monde. C'est la nuance que les échelles de simulation
    // imposent : un habitant calculé une fois par heure peut parfaitement
    // avoir une activité terminée depuis vingt minutes — elle sera clôturée à
    // son prochain réveil, et personne ne peut l'observer entre-temps. En
    // revanche, une activité déjà finie AU MOMENT où on l'a mis à jour est un
    // vrai défaut : la boucle a manqué sa clôture.
    if (p.activite !== null && p.activite.jusqua < p.derniereMaj) {
      signaler(
        'activite-en-cours',
        `${ou} a une activité finie au tick ${p.activite.jusqua}, ` +
          `non clôturée lors de sa mise à jour du tick ${p.derniereMaj}`,
      );
    }
    if (p.activite?.type === 'deplacement' && !monde.lieux.has(p.activite.vers)) {
      signaler('destination-existe', `${ou} se déplace vers le lieu inconnu #${p.activite.vers}`);
    }

    if (!monde.lieux.has(p.domicile)) {
      signaler('domicile-existe', `${ou} a un domicile inconnu #${p.domicile}`);
    }
    if (p.occupation.type !== 'aucune' && !monde.lieux.has(p.occupation.lieu)) {
      signaler('occupation-existe', `${ou} travaille ou étudie dans un lieu inconnu`);
    }

    if (p.derniereMaj > monde.tick) {
      signaler('maj-passee', `${ou} a été mis à jour dans le futur`);
    }
  }

  // --- Les lieux ------------------------------------------------------------
  for (const l of monde.lieux.values()) {
    const vus = new Set<number>();
    for (const id of l.occupants) {
      if (vus.has(id)) {
        signaler('occupant-unique', `« ${l.nom} » compte #${id} deux fois`);
      }
      vus.add(id);

      const p = monde.personnages.get(id);
      if (p === undefined) {
        signaler('occupant-existe', `« ${l.nom} » contient l'inconnu #${id}`);
      } else if (p.lieu !== l.id) {
        signaler('presence-reciproque', `« ${l.nom} » retient #${id}, qui est ailleurs`);
      }
    }

    if (l.occupants.length > l.capacite) {
      signaler(
        'capacite',
        `« ${l.nom} » accueille ${l.occupants.length} personnes pour ${l.capacite} places`,
      );
    }
  }

  // --- Tout le monde est quelque part, une seule fois -----------------------
  let placements = 0;
  for (const l of monde.lieux.values()) placements += l.occupants.length;
  if (placements !== monde.personnages.size) {
    signaler(
      'placement-unique',
      `${placements} placements pour ${monde.personnages.size} habitants : ` +
        'quelqu\'un est en double ou nulle part',
    );
  }

  return violations;
}

/** Formate les violations pour un message d'échec de test lisible. */
export function decrireViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return 'aucune violation';
  return violations.map((v) => `[${v.regle}] ${v.detail}`).join('\n');
}

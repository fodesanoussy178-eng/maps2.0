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
import { VERSION_ETAT } from './monde.ts';
import { BESOINS, BESOIN_MAX, besoin } from './personnage.ts';
import { TRAITS, trait } from './personnage.ts';
import { apparenceValide } from './apparence.ts';
import { positionValide } from './position.ts';

export interface Violation {
  regle: string;
  detail: string;
}

export function verifierInvariants(monde: Monde): Violation[] {
  const violations: Violation[] = [];
  const signaler = (regle: string, detail: string): void => {
    violations.push({ regle, detail });
  };

  if (monde.version !== VERSION_ETAT) {
    signaler('version-etat', `le monde porte le schéma ${monde.version}, le code attend ${VERSION_ETAT}`);
  }

  // --- Les personnages ------------------------------------------------------
  for (const p of monde.personnages.values()) {
    const ou = `${p.prenom} ${p.nom} (#${p.id})`;

    const lieu = monde.lieux.get(p.position.lieu);
    if (lieu === undefined) {
      signaler('lieu-existe', `${ou} se trouve dans le lieu inconnu #${p.position.lieu}`);
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

    // --- position -----------------------------------------------------------
    for (const faute of positionValide(p.position)) {
      signaler('position-bornee', `${ou} a une position hors bornes : ${faute}`);
    }
    if (p.position.piece !== null) {
      // Aucun lieu n'a encore d'intérieur : une pièce renseignée signifierait
      // qu'on a posé quelqu'un dans une pièce qui n'existe nulle part.
      signaler('piece-inexistante', `${ou} est dans la pièce #${p.position.piece}, sans intérieur simulé`);
    }

    // --- apparence ----------------------------------------------------------
    for (const faute of apparenceValide(p.apparence)) {
      signaler('apparence-valide', `${ou} a une apparence invalide : ${faute}`);
    }

    // --- foyer --------------------------------------------------------------
    const foyer = monde.foyers.get(p.foyer);
    if (foyer === undefined) {
      signaler('foyer-existe', `${ou} appartient au foyer inconnu #${p.foyer}`);
    } else if (!foyer.membres.includes(p.id)) {
      signaler('foyer-reciproque', `${ou} pointe un foyer qui ne le compte pas`);
    } else if (!monde.lieux.has(foyer.logement)) {
      signaler('logement-existe', `${ou} a un foyer logé dans un lieu inconnu`);
    }

    // --- poste --------------------------------------------------------------
    if (p.poste !== null) {
      const poste = monde.postes.get(p.poste);
      if (poste === undefined) {
        signaler('poste-existe', `${ou} occupe le poste inconnu #${p.poste}`);
      } else {
        if (poste.titulaire !== p.id) {
          signaler('poste-reciproque', `${ou} occupe « ${poste.intitule} », dont il n'est pas titulaire`);
        }
        if (!monde.lieux.has(poste.lieu)) {
          signaler('poste-lieu', `${ou} occupe un poste situé dans un lieu inconnu`);
        }
      }
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
      } else if (p.position.lieu !== l.id) {
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

  // --- Les foyers -----------------------------------------------------------
  for (const f of monde.foyers.values()) {
    if (!monde.lieux.has(f.logement)) {
      signaler('logement-existe', `le foyer #${f.id} est logé dans un lieu inconnu`);
    }
    const vus = new Set<number>();
    for (const id of f.membres) {
      if (vus.has(id)) signaler('membre-unique', `le foyer #${f.id} compte #${id} deux fois`);
      vus.add(id);
      const membre = monde.personnages.get(id);
      if (membre === undefined) {
        signaler('membre-existe', `le foyer #${f.id} compte l'inconnu #${id}`);
      } else if (membre.foyer !== f.id) {
        signaler('foyer-reciproque', `le foyer #${f.id} retient #${id}, qui appartient à un autre`);
      }
    }
    if (f.membres.length === 0) {
      signaler('foyer-habite', `le foyer #${f.id} n'a aucun membre`);
    }
  }

  // --- Les postes -----------------------------------------------------------
  for (const poste of monde.postes.values()) {
    if (!monde.lieux.has(poste.lieu)) {
      signaler('poste-lieu', `le poste « ${poste.intitule} » est dans un lieu inconnu`);
    }
    if (poste.debutH >= poste.finH) {
      signaler('poste-horaires', `le poste « ${poste.intitule} » finit avant de commencer`);
    }
    if (poste.salaireHoraire < 0) {
      signaler('poste-salaire', `le poste « ${poste.intitule} » a un salaire négatif`);
    }
    if (poste.titulaire !== null) {
      const titulaire = monde.personnages.get(poste.titulaire);
      if (titulaire === undefined) {
        signaler('titulaire-existe', `le poste « ${poste.intitule} » est tenu par un inconnu`);
      } else if (titulaire.poste !== poste.id) {
        signaler('poste-reciproque', `le poste « ${poste.intitule} » retient quelqu'un qui occupe autre chose`);
      }
    }
  }

  // --- Les relations --------------------------------------------------------
  // La collection est encore vide, et ces contrôles sont donc muets. Ils sont
  // armés dès maintenant pour tomber le jour où le moteur social l'écrira.
  for (const [cle, r] of monde.relations) {
    if (cle !== `${r.de}>${r.vers}`) {
      signaler('relation-clef', `la relation ${cle} ne correspond pas à son contenu`);
    }
    if (r.de === r.vers) {
      signaler('relation-reflexive', `#${r.de} a une relation avec lui-même`);
    }
    if (!monde.personnages.has(r.de) || !monde.personnages.has(r.vers)) {
      signaler('relation-orpheline', `la relation ${cle} vise quelqu'un qui n'existe pas`);
    }
    if (!monde.relations.has(`${r.vers}>${r.de}`)) {
      // Une relation dirigée n'est pas symétrique dans ses VALEURS, mais elle
      // existe des deux côtés : se connaître est réciproque, s'apprécier non.
      signaler('relation-reciproque', `la relation ${cle} n'a pas de contrepartie`);
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

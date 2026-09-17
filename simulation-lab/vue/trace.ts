/**
 * L'enregistrement d'une tranche de vie du quartier.
 *
 * La vue ne simule rien : elle REJOUE. La simulation tourne ici, en Node, et
 * produit une trace compacte que la page web se contente d'afficher. C'est ce
 * qui permet à la page d'être un seul fichier HTML sans une ligne de code de
 * simulation, sans outil de construction et sans dépendance.
 *
 * Ce n'est pas le jeu : c'est la preuve visible que la simulation produit des
 * journées qui tiennent debout.
 */

import { TICKS_PAR_JOUR, age, calendrier } from '../noyau/index.ts';
import { genererMonde } from '../monde/generation.ts';
import { avancer } from '../boucle/boucle.ts';
import { verifierInvariants } from '../etat/invariants.ts';
import { trait } from '../etat/personnage.ts';
import { disposer, type Plan } from './disposition.ts';

export interface TraceHabitant {
  nom: string;
  age: number;
  occupation: string;
  domicile: number;
  sociabilite: number;
  discipline: number;
  impulsivite: number;
}

export interface Trace {
  meta: {
    graine: number;
    population: number;
    jours: number;
    pas: number;
    tickDepart: number;
    dureeMs: number;
    violations: number;
  };
  plan: Plan;
  habitants: TraceHabitant[];
  /** Table des noms d'activité ; les images n'en stockent que l'indice. */
  activites: string[];
  /** Une image par `pas` ticks : indice de lieu et indice d'activité, par habitant. */
  images: { t: number; lieux: number[]; actes: number[] }[];
}

export interface OptionsTrace {
  graine: number;
  population: number;
  jours: number;
  /** Ticks entre deux images. 3 = un quart d'heure de jeu. */
  pas: number;
}

export function enregistrer(options: OptionsTrace): Trace {
  const { monde } = genererMonde({ graine: options.graine, population: options.population });
  const plan = disposer(monde.lieux.values());

  const indexLieu = new Map<number, number>();
  plan.boites.forEach((b, i) => indexLieu.set(b.id, i));

  const habitants: TraceHabitant[] = [];
  const ordre: number[] = [];
  for (const p of monde.personnages.values()) {
    ordre.push(p.id as number);
    habitants.push({
      nom: `${p.prenom} ${p.nom}`,
      age: age(p.naissance, monde.tick),
      occupation:
        p.occupation.type === 'emploi'
          ? `travaille ${p.occupation.debutH} h – ${p.occupation.finH} h`
          : p.occupation.type === 'etudes'
            ? `élève, ${p.occupation.debutH} h – ${p.occupation.finH} h`
            : 'sans occupation',
      domicile: indexLieu.get(p.domicile as number) ?? 0,
      sociabilite: trait(p, 'sociabilite'),
      discipline: trait(p, 'discipline'),
      impulsivite: trait(p, 'impulsivite'),
    });
  }

  const activites: string[] = [];
  const indexActe = new Map<string, number>();
  const acteCourant = new Map<number, number>();

  const noterActe = (nom: string): number => {
    const connu = indexActe.get(nom);
    if (connu !== undefined) return connu;
    const i = activites.length;
    activites.push(nom);
    indexActe.set(nom, i);
    return i;
  };
  noterActe('flaner');

  const observateur = {
    surActivite: (_m: unknown, p: { id: number }, acte: string): void => {
      acteCourant.set(p.id as number, noterActe(acte));
    },
  };

  const images: Trace['images'] = [];
  const total = options.jours * TICKS_PAR_JOUR;
  const debut = performance.now();

  for (let ecoule = 0; ecoule < total; ecoule += options.pas) {
    const pas = Math.min(options.pas, total - ecoule);
    avancer(monde, pas, { observateur: observateur as never });

    const lieux: number[] = [];
    const actes: number[] = [];
    for (const id of ordre) {
      const p = monde.personnages.get(id as never);
      lieux.push(p === undefined ? 0 : (indexLieu.get(p.lieu as number) ?? 0));
      actes.push(acteCourant.get(id) ?? 0);
    }
    images.push({ t: monde.tick, lieux, actes });
  }

  const dureeMs = performance.now() - debut;
  const violations = verifierInvariants(monde).length;

  return {
    meta: {
      graine: options.graine,
      population: options.population,
      jours: options.jours,
      pas: options.pas,
      tickDepart: images[0]?.t ?? 0,
      dureeMs: Math.round(dureeMs),
      violations,
    },
    plan,
    habitants,
    activites,
    images,
  };
}

/** Heure lisible d'une image, pour l'horloge de la vue. */
export function horodatage(tick: number): { jour: number; heure: string } {
  const c = calendrier(tick);
  return {
    jour: Math.floor(tick / TICKS_PAR_JOUR),
    heure: `${String(c.heure).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`,
  };
}

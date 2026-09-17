/**
 * Le bus d'événements.
 *
 * Le §28 du cahier des charges demande une architecture événementielle
 * plutôt qu'un recalcul général à chaque image. C'est le bon choix, mais un
 * bus naïf — où publier appelle immédiatement les abonnés, qui publient à
 * leur tour — détruit deux propriétés dont le projet ne peut pas se passer :
 *
 *   - l'ordre d'exécution devient dépendant de la profondeur d'appel, donc
 *     imprévisible, donc le déterminisme meurt ;
 *   - une boucle de causalité (A provoque B qui provoque A) fige le jeu.
 *
 * Ce bus-ci est donc une FILE, pas une cascade d'appels :
 *
 *   - publier ajoute en fin de file, ne déclenche rien ;
 *   - `traiter` vide la file dans l'ordre d'insertion, y compris les
 *     événements produits pendant le traitement ;
 *   - les abonnés sont appelés dans leur ordre d'abonnement, figé au
 *     démarrage : `abonner` est refusé une fois le bus figé ;
 *   - chaque événement porte l'identifiant de celui qui l'a provoqué, ce qui
 *     construit gratuitement le graphe causal du §18 ;
 *   - la profondeur de cascade est bornée : au-delà, l'événement est
 *     journalisé comme anomalie au lieu de faire tourner la boucle.
 */

export interface Evenement<C = unknown> {
  id: number;
  type: string;
  tick: number;
  /** L'événement qui a provoqué celui-ci. `null` pour une cause première. */
  cause: number | null;
  /** Longueur de la chaîne causale depuis la cause première. */
  profondeur: number;
  charge: C;
}

export interface Anomalie {
  raison: 'profondeur' | 'debordement';
  type: string;
  tick: number;
  profondeur: number;
}

/** Ce qu'un abonné reçoit pour réagir. Il ne peut que publier à son tour. */
export interface Contexte {
  publier: (type: string, charge: unknown, cause?: Evenement | null) => void;
}

export type Abonne = (evenement: Evenement, contexte: Contexte) => void;

interface Inscription {
  type: string;
  nom: string;
  reagir: Abonne;
}

export interface Bus {
  inscriptions: Inscription[];
  file: Evenement[];
  prochainId: number;
  fige: boolean;
  profondeurMax: number;
  tailleMax: number;
  anomalies: Anomalie[];
  /** Événements traités pendant la dernière passe. Vidé à chaque `traiter`. */
  traites: Evenement[];
  /** Conserver les événements traités coûte de la mémoire : réservé au débogage. */
  tracer: boolean;
}

export function creerBus(options: {
  profondeurMax?: number;
  tailleMax?: number;
  tracer?: boolean;
} = {}): Bus {
  return {
    inscriptions: [],
    file: [],
    prochainId: 1,
    fige: false,
    profondeurMax: options.profondeurMax ?? 8,
    tailleMax: options.tailleMax ?? 4096,
    anomalies: [],
    traites: [],
    tracer: options.tracer ?? false,
  };
}

/**
 * Abonne une réaction à un type d'événement. Le `nom` sert au diagnostic et
 * rend l'ordre d'exécution lisible dans les traces.
 *
 * L'abonnement est interdit après `figer` : un abonné ajouté en cours de
 * partie décalerait l'ordre d'exécution, et deux parties issues de la même
 * graine divergeraient.
 */
export function abonner(bus: Bus, type: string, nom: string, reagir: Abonne): void {
  if (bus.fige) {
    throw new Error(
      `Abonnement tardif de « ${nom} » sur « ${type} » : le bus est figé. ` +
        'Tous les abonnements doivent être posés au démarrage, sinon le ' +
        "déterminisme du rejeu n'est plus garanti.",
    );
  }
  bus.inscriptions.push({ type, nom, reagir });
}

export function figer(bus: Bus): void {
  bus.fige = true;
}

export function publier(
  bus: Bus,
  type: string,
  tick: number,
  charge: unknown,
  cause: Evenement | null = null,
): Evenement | null {
  const profondeur = cause === null ? 0 : cause.profondeur + 1;

  if (profondeur > bus.profondeurMax) {
    bus.anomalies.push({ raison: 'profondeur', type, tick, profondeur });
    return null;
  }
  if (bus.file.length >= bus.tailleMax) {
    bus.anomalies.push({ raison: 'debordement', type, tick, profondeur });
    return null;
  }

  const evenement: Evenement = {
    id: bus.prochainId,
    type,
    tick,
    cause: cause === null ? null : cause.id,
    profondeur,
    charge,
  };
  bus.prochainId += 1;
  bus.file.push(evenement);
  return evenement;
}

/**
 * Vide la file. Les événements publiés pendant le traitement sont traités
 * dans la même passe, après ceux déjà en file — c'est ce qui permet à une
 * chaîne causale de se dérouler entièrement dans le tick où elle commence,
 * sans récursion.
 *
 * Renvoie le nombre d'événements traités.
 */
export function traiter(bus: Bus, tick: number): number {
  bus.traites.length = 0;
  let traitesCount = 0;

  // Index plutôt que `shift()` : décaler un tableau à chaque événement est en
  // O(n²) sur une cascade un peu large.
  let curseur = 0;
  while (curseur < bus.file.length) {
    const evenement = bus.file[curseur];
    curseur += 1;
    if (evenement === undefined) continue;

    const contexte: Contexte = {
      publier: (type, charge, cause = evenement) => {
        publier(bus, type, tick, charge, cause);
      },
    };

    for (const inscription of bus.inscriptions) {
      if (inscription.type !== evenement.type) continue;
      inscription.reagir(evenement, contexte);
    }

    traitesCount += 1;
    if (bus.tracer) bus.traites.push(evenement);
  }

  bus.file.length = 0;
  return traitesCount;
}

/**
 * Remonte une chaîne causale, du plus récent au plus ancien. Demande le
 * traçage actif — c'est un outil de débogage, et la chronique du joueur sera
 * construite plus tard sur les jalons, pas sur tous les événements.
 */
export function chaineCausale(bus: Bus, id: number): Evenement[] {
  const parId = new Map<number, Evenement>();
  for (const e of bus.traites) parId.set(e.id, e);

  const chaine: Evenement[] = [];
  let courant = parId.get(id);
  while (courant !== undefined) {
    chaine.push(courant);
    courant = courant.cause === null ? undefined : parId.get(courant.cause);
  }
  return chaine;
}

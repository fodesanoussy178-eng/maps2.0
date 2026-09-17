import { describe, expect, it } from 'vitest';
import {
  abonner,
  chaineCausale,
  creerBus,
  figer,
  publier,
  traiter,
  type Evenement,
} from './evenements.ts';

describe("bus d'événements", () => {
  it('traite dans l\'ordre de publication, abonnés dans l\'ordre d\'abonnement', () => {
    const bus = creerBus();
    const trace: string[] = [];
    abonner(bus, 'x', 'premier', (e) => trace.push(`1:${String(e.charge)}`));
    abonner(bus, 'x', 'second', (e) => trace.push(`2:${String(e.charge)}`));
    figer(bus);

    publier(bus, 'x', 0, 'a');
    publier(bus, 'x', 0, 'b');
    traiter(bus, 0);

    expect(trace).toEqual(['1:a', '2:a', '1:b', '2:b']);
  });

  it('ne déclenche rien tant que la file n\'est pas traitée', () => {
    const bus = creerBus();
    let appels = 0;
    abonner(bus, 'x', 'compteur', () => {
      appels += 1;
    });
    figer(bus);

    publier(bus, 'x', 0, null);
    expect(appels).toBe(0);
    traiter(bus, 0);
    expect(appels).toBe(1);
  });

  it('déroule une cascade entière dans la même passe, sans récursion', () => {
    const bus = creerBus({ tracer: true });
    const trace: string[] = [];
    abonner(bus, 'embauche', 'demenage', (e, ctx) => {
      trace.push('embauche');
      ctx.publier('demenagement', e.charge);
    });
    abonner(bus, 'demenagement', 'rencontre', (e, ctx) => {
      trace.push('demenagement');
      ctx.publier('rencontre', e.charge);
    });
    abonner(bus, 'rencontre', 'note', () => trace.push('rencontre'));
    figer(bus);

    publier(bus, 'embauche', 10, { perso: 3 });
    const traites = traiter(bus, 10);

    expect(trace).toEqual(['embauche', 'demenagement', 'rencontre']);
    expect(traites).toBe(3);
    expect(bus.file).toHaveLength(0);
  });

  it('porte la causalité, ce qui suffit à reconstruire la chronique', () => {
    const bus = creerBus({ tracer: true });
    abonner(bus, 'a', 'vers-b', (_e, ctx) => ctx.publier('b', null));
    abonner(bus, 'b', 'vers-c', (_e, ctx) => ctx.publier('c', null));
    figer(bus);

    publier(bus, 'a', 5, null);
    traiter(bus, 5);

    const dernier = bus.traites[bus.traites.length - 1] as Evenement;
    expect(dernier.type).toBe('c');
    expect(dernier.profondeur).toBe(2);
    expect(chaineCausale(bus, dernier.id).map((e) => e.type)).toEqual(['c', 'b', 'a']);
  });

  it('coupe une boucle de causalité au lieu de figer le jeu', () => {
    const bus = creerBus({ profondeurMax: 5 });
    abonner(bus, 'ping', 'rebond', (_e, ctx) => ctx.publier('ping', null));
    figer(bus);

    publier(bus, 'ping', 0, null);
    const traites = traiter(bus, 0);

    expect(traites).toBe(6); // profondeurs 0 à 5
    expect(bus.anomalies).toHaveLength(1);
    expect(bus.anomalies[0]?.raison).toBe('profondeur');
  });

  it('refuse un abonnement tardif, qui casserait le rejeu déterministe', () => {
    const bus = creerBus();
    abonner(bus, 'x', 'tot', () => undefined);
    figer(bus);
    expect(() => abonner(bus, 'x', 'tard', () => undefined)).toThrow(/figé/);
  });

  it('journalise un débordement plutôt que de consommer toute la mémoire', () => {
    const bus = creerBus({ tailleMax: 4 });
    figer(bus);
    for (let i = 0; i < 10; i += 1) publier(bus, 'x', 0, i);
    expect(bus.file).toHaveLength(4);
    expect(bus.anomalies.filter((a) => a.raison === 'debordement')).toHaveLength(6);
  });

  it('ignore les événements sans abonné sans se plaindre', () => {
    const bus = creerBus();
    figer(bus);
    publier(bus, 'personne-n-ecoute', 0, null);
    expect(traiter(bus, 0)).toBe(1);
    expect(bus.anomalies).toHaveLength(0);
  });
});

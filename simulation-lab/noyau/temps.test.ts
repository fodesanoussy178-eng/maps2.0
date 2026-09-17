import { describe, expect, it } from 'vitest';
import {
  ANNEE_EPOQUE,
  TICKS_PAR_AN,
  TICKS_PAR_JOUR,
  age,
  calendrier,
  estWeekEnd,
  formaterDate,
  heureDecimale,
  modeControle,
  tickDepuisDate,
  ticksDus,
} from './temps.ts';

describe('temps', () => {
  it('reconstitue la date exacte depuis le tick', () => {
    const c = calendrier(0);
    expect(c).toMatchObject({ annee: ANNEE_EPOQUE, mois: 1, jour: 1, heure: 0, minute: 0 });

    const midi = calendrier(TICKS_PAR_JOUR * 45 + 12 * 12 + 7);
    expect(midi).toMatchObject({ mois: 2, jour: 15, heure: 12, minute: 35 });
  });

  it('fait un aller-retour exact entre tick et date', () => {
    // La propriété qui empêche toute dérive de calendrier sur une partie de
    // plusieurs siècles.
    for (const tick of [0, 1, 287, 288, 10_000, 365 * 288, 12_345_678]) {
      const c = calendrier(tick);
      expect(tickDepuisDate(c.annee, c.mois, c.jour, c.heure, c.minute)).toBe(tick);
    }
  });

  it('ne perd aucun jour sur une année complète', () => {
    const jours = new Set<string>();
    for (let j = 0; j < 365; j += 1) {
      const c = calendrier(j * TICKS_PAR_JOUR);
      jours.add(`${c.mois}-${c.jour}`);
      expect(c.annee).toBe(ANNEE_EPOQUE);
    }
    expect(jours.size).toBe(365);
    expect(calendrier(365 * TICKS_PAR_JOUR).annee).toBe(ANNEE_EPOQUE + 1);
  });

  it('place les saisons et les week-ends de façon stable', () => {
    expect(calendrier(0).saison).toBe('hiver');
    expect(calendrier(100 * TICKS_PAR_JOUR).saison).toBe('printemps');
    expect(calendrier(200 * TICKS_PAR_JOUR).saison).toBe('ete');
    expect(calendrier(280 * TICKS_PAR_JOUR).saison).toBe('automne');

    // 1er janvier = lundi, donc les samedis tombent tous les 5 + 7k jours.
    expect(estWeekEnd(0)).toBe(false);
    expect(estWeekEnd(5 * TICKS_PAR_JOUR)).toBe(true);
    expect(estWeekEnd(6 * TICKS_PAR_JOUR)).toBe(true);
    expect(estWeekEnd(7 * TICKS_PAR_JOUR)).toBe(false);
  });

  it('calcule un âge en années révolues', () => {
    const naissance = tickDepuisDate(1990, 6, 15);
    expect(age(naissance, naissance)).toBe(0);
    expect(age(naissance, naissance + TICKS_PAR_AN - 1)).toBe(0);
    expect(age(naissance, naissance + TICKS_PAR_AN)).toBe(1);
    expect(age(naissance, naissance + 30 * TICKS_PAR_AN)).toBe(30);
  });

  it('donne une heure décimale exploitable par les courbes horaires', () => {
    expect(heureDecimale(0)).toBe(0);
    expect(heureDecimale(12 * 12)).toBe(12);
    expect(heureDecimale(12 * 12 + 6)).toBe(12.5);
  });

  it('bascule le mode de contrôle au-delà de ×10', () => {
    // Arbitrage de la contradiction C1 : à ×50, une seconde réelle vaut
    // cinquante minutes de jeu ; diriger des pas n'a plus de sens.
    expect(modeControle(1)).toBe('incarne');
    expect(modeControle(10)).toBe('incarne');
    expect(modeControle(50)).toBe('intention');
    expect(modeControle(500)).toBe('intention');
  });

  it('reporte le reste au lieu de perdre le temps par arrondi', () => {
    // À ×1, une image de 16 ms vaut 0,0033 tick. Sans report, chaque image
    // arrondirait à zéro et la simulation n'avancerait JAMAIS d'un seul tick.
    let reste = 0;
    let avecReport = 0;
    let sansReport = 0;
    for (let i = 0; i < 60 * 60; i += 1) {
      const b = ticksDus(1, 1000 / 60, reste);
      avecReport += b.ticks;
      reste = b.reste;
      sansReport += ticksDus(1, 1000 / 60, 0).ticks;
    }
    expect(sansReport).toBe(0);
    // 60 secondes réelles à ×1 = 60 minutes de jeu = 12 ticks. La tolérance
    // d'un tick couvre l'accumulation flottante du report : le temps réel
    // n'entre jamais dans l'état de la simulation, seul le compte de ticks y
    // entre, donc cette imprécision-là n'a aucun effet sur le déterminisme.
    expect(avecReport).toBeGreaterThanOrEqual(11);
    expect(avecReport).toBeLessThanOrEqual(12);
  });

  it('ne simule rien en pause', () => {
    expect(ticksDus(0, 10_000, 0)).toEqual({ ticks: 0, reste: 0, sature: false });
  });

  it('plafonne le rattrapage pour éviter la spirale de la mort', () => {
    const b = ticksDus(500, 120_000, 0);
    expect(b.sature).toBe(true);
    expect(b.ticks).toBe(600);
    expect(b.reste).toBe(0);
  });

  it('formate une date lisible', () => {
    // Jeudi et non mercredi : le calendrier du jeu ignore les années
    // bissextiles (voir temps.ts). Le décalage avec le calendrier réel est
    // d'un jour tous les quatre ans et aucun système du jeu ne peut le
    // percevoir — en échange, la conversion tick → date reste exacte sur
    // plusieurs siècles de partie.
    expect(formaterDate(tickDepuisDate(2001, 3, 14, 8, 35))).toBe(
      'jeudi 14/3/2001, 08:35',
    );
  });
});

/**
 * Le point d'entrée du jeu.
 *
 * Trois écrans : le menu, la création, la partie. Rien de plus.
 *
 * La boucle d'image ne fait que deux choses : demander à l'horloge d'avancer
 * le monde de ce que vaut l'intervalle réel écoulé, puis dessiner l'état
 * obtenu. Elle ne décide de rien. Si on la supprimait, la simulation
 * fonctionnerait encore — c'est ce que vérifient les tests.
 */

import type { PersoId } from '../noyau/index.ts';
import { age } from '../noyau/index.ts';
import { BESOINS, besoin, nomComplet, trait } from '../etat/personnage.ts';
import type { Personnage } from '../etat/personnage.ts';
import { domicile, posteDe } from '../etat/monde.ts';
import type { Partie } from './partie.ts';
import {
  avancerPartie,
  commanderArret,
  commanderAutonomie,
  commanderDeplacement,
  commencerPartie,
  horodatage,
  personnageJoueur,
} from './partie.ts';
import { ecranCreation } from './creation.ts';
import type { Scene } from './scene.ts';
import { batimentSous, creerScene, dessinerScene, habitantSous, positionDe } from './scene.ts';
import type { Camera } from './camera.ts';
import { borner, creerCamera, deplacer, suivre, versEcran, zoomer } from './camera.ts';
import { VITESSES_JEU } from './horloge.ts';
import type { VitesseJeu } from './horloge.ts';

const racine = document.getElementById('jeu');
if (racine === null) throw new Error('#jeu introuvable');

let partie: Partie | null = null;
let scene: Scene | null = null;
let camera: Camera | null = null;
let selection: PersoId | null = null;
let batimentSurvole: number | null = null;
let boucleLancee = false;

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function menu(): void {
  racine!.innerHTML = `
    <div class="menu">
      <h1>Quartier Témoin</h1>
      <p>Soixante habitants y vivent déjà. Ils ont un logement, un travail ou une école, des besoins et un caractère — et ils ne vous ont pas attendu.</p>
      <p>Vous allez en devenir un.</p>
      <div class="menu-reglages">
        <label>Habitants <input id="population" type="range" min="30" max="300" step="10" value="60"><output id="population-val">60</output></label>
        <label>Graine <input id="graine" type="number" value="1" min="1" max="999999"></label>
      </div>
      <button id="nouvelle" class="primaire" type="button">Nouvelle partie</button>
      <p class="petite">Molette pour zoomer · glisser pour déplacer la caméra · clic sur un bâtiment pour vous y rendre · clic sur un habitant pour l'observer.</p>
    </div>`;

  const pop = racine!.querySelector<HTMLInputElement>('#population');
  const popVal = racine!.querySelector('#population-val');
  pop?.addEventListener('input', () => { if (popVal !== null) popVal.textContent = pop.value; });

  racine!.querySelector('#nouvelle')?.addEventListener('click', () => {
    const population = Number(pop?.value ?? 60);
    const graine = Number(racine!.querySelector<HTMLInputElement>('#graine')?.value ?? 1);
    creation(population, graine);
  });
}

function creation(population: number, graine: number): void {
  ecranCreation(racine!, (fiche) => {
    partie = commencerPartie({ graine, population, fiche });
    scene = creerScene(partie.monde);
    camera = creerCamera(scene.ville.largeur / 2, scene.ville.hauteur / 2, 1.1);
    camera.suivi = partie.joueur as number;
    selection = partie.joueur;
    // Poignée de diagnostic : elle permet de vérifier de l'extérieur que ce
    // qui est affiché correspond bien à l'état simulé, et que le temps avance
    // vraiment. Elle ne sert à rien d'autre et ne pilote rien.
    (window as unknown as Record<string, unknown>).__partie = () => partie;
    (window as unknown as Record<string, unknown>).__scene = () => scene;
    jeu();
  });
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------

function jeu(): void {
  racine!.innerHTML = `
    <div class="scene">
      <canvas id="toile"></canvas>
      <div class="hud-haut">
        <div class="horloge"><b id="heure">--:--</b><span id="jour"></span></div>
        <div class="vitesses" id="vitesses"></div>
        <button id="recentrer" class="secondaire" type="button">Mon personnage</button>
      </div>
      <div class="panneau" id="panneau"></div>
      <div class="hud-bas">
        <span id="etat-joueur"></span>
        <button id="laisser" class="secondaire" type="button">Le laisser décider</button>
        <button id="arreter" class="secondaire" type="button">S'arrêter</button>
      </div>
    </div>`;

  const toile = racine!.querySelector<HTMLCanvasElement>('#toile');
  const ctx = toile?.getContext('2d') ?? null;
  if (toile === null || ctx === null) return;

  const redimensionner = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    toile.width = toile.clientWidth * dpr;
    toile.height = toile.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  redimensionner();
  window.addEventListener('resize', redimensionner);

  const dim = (): { largeur: number; hauteur: number } => ({
    largeur: toile.clientWidth, hauteur: toile.clientHeight,
  });

  // --- vitesses -------------------------------------------------------------
  const boiteVitesses = racine!.querySelector('#vitesses');
  const peindreVitesses = (): void => {
    if (boiteVitesses === null || partie === null) return;
    boiteVitesses.innerHTML = VITESSES_JEU.map((v) =>
      `<button data-v="${v}" aria-pressed="${v === partie!.horloge.vitesse}">${v === 0 ? '❚❚' : `×${v}`}</button>`,
    ).join('');
  };
  boiteVitesses?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (b === null || partie === null) return;
    partie.horloge.vitesse = Number(b.dataset.v) as VitesseJeu;
    peindreVitesses();
  });
  peindreVitesses();

  window.addEventListener('keydown', (e) => {
    if (partie === null) return;
    if (e.key === ' ') {
      e.preventDefault();
      partie.horloge.vitesse = partie.horloge.vitesse === 0 ? 1 : 0;
      peindreVitesses();
    }
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) { partie.horloge.vitesse = VITESSES_JEU[i + 1] ?? 1; peindreVitesses(); }
  });

  // --- caméra ---------------------------------------------------------------
  let glisse = false;
  let dernier = { x: 0, y: 0 };
  let bouge = 0;

  toile.addEventListener('pointerdown', (e) => {
    glisse = true; bouge = 0; dernier = { x: e.clientX, y: e.clientY };
    toile.setPointerCapture(e.pointerId);
  });
  toile.addEventListener('pointermove', (e) => {
    if (camera === null || scene === null) return;
    if (glisse) {
      const dx = e.clientX - dernier.x;
      const dy = e.clientY - dernier.y;
      bouge += Math.abs(dx) + Math.abs(dy);
      if (bouge > 4) deplacer(camera, dx, dy);
      dernier = { x: e.clientX, y: e.clientY };
      borner(camera, scene.ville.largeur, scene.ville.hauteur);
      return;
    }
    const r = toile.getBoundingClientRect();
    const b = batimentSous(scene, camera, dim(), e.clientX - r.left, e.clientY - r.top);
    batimentSurvole = b?.indice ?? null;
    toile.style.cursor = b === null ? 'grab' : 'pointer';
  });
  toile.addEventListener('pointerup', (e) => {
    glisse = false;
    if (bouge > 4 || partie === null || scene === null || camera === null) return;
    const r = toile.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    const h = habitantSous(scene, partie.monde, camera, dim(), x, y);
    if (h !== null) { selection = h.id; peindrePanneau(); return; }

    const b = batimentSous(scene, camera, dim(), x, y);
    if (b !== null) {
      // Clic sur un bâtiment : on s'y rend. C'est la commande de déplacement,
      // et elle emprunte la voirie comme celle des autres habitants.
      commanderDeplacement(partie, b.batiment.id as never);
      selection = partie.joueur;
      peindrePanneau();
    }
  });
  toile.addEventListener('wheel', (e) => {
    if (camera === null) return;
    e.preventDefault();
    const r = toile.getBoundingClientRect();
    zoomer(camera, dim(), e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  racine!.querySelector('#recentrer')?.addEventListener('click', () => {
    if (partie === null || camera === null) return;
    camera.suivi = partie.joueur as number;
    selection = partie.joueur;
    peindrePanneau();
  });
  racine!.querySelector('#arreter')?.addEventListener('click', () => {
    if (partie !== null) commanderArret(partie);
  });
  racine!.querySelector('#laisser')?.addEventListener('click', () => {
    if (partie !== null) commanderAutonomie(partie);
  });

  // --- panneau --------------------------------------------------------------
  const panneau = racine!.querySelector('#panneau');
  function peindrePanneau(): void {
    if (panneau === null || partie === null) return;
    const p = selection === null ? null : partie.monde.personnages.get(selection);
    if (p === null || p === undefined) { panneau.innerHTML = ''; return; }
    panneau.innerHTML = ficheHtml(partie, p);
  }

  // --- boucle ---------------------------------------------------------------
  let precedent = 0;
  const image = (ms: number): void => {
    if (partie === null || scene === null || camera === null) { boucleLancee = false; return; }
    const delta = precedent === 0 ? 16 : Math.min(ms - precedent, 250);
    precedent = ms;

    // ► LA simulation. Le rendu qui suit ne fait que la regarder.
    avancerPartie(partie, delta);

    if (camera.suivi !== null) {
      const j = partie.monde.personnages.get(camera.suivi as PersoId);
      if (j !== undefined) {
        const m = positionDe(scene, partie.monde, j);
        suivre(camera, m.x, m.y);
      }
    }

    dessinerScene(ctx, scene, partie.monde, camera, dim(), {
      joueur: partie.joueur,
      selection,
      batimentSurvole,
      temps: ms,
    });

    // Le personnage du joueur, quand il est à l'intérieur, reste repérable.
    const j = personnageJoueur(partie);
    if (j !== undefined) {
      const m = positionDe(scene, partie.monde, j);
      const e = versEcran(camera, dim(), m.x, m.y);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - 34 * camera.zoom);
      ctx.lineTo(e.x - 6, e.y - 46 * camera.zoom);
      ctx.lineTo(e.x + 6, e.y - 46 * camera.zoom);
      ctx.closePath();
      ctx.fillStyle = '#F2C14E';
      ctx.fill();
    }

    const t = horodatage(partie.monde);
    const eh = document.getElementById('heure');
    const ej = document.getElementById('jour');
    if (eh !== null) eh.textContent = t.heure;
    if (ej !== null) ej.textContent = t.jour;

    const etat = document.getElementById('etat-joueur');
    if (etat !== null && j !== undefined) etat.textContent = resumeActivite(partie, j);

    peindrePanneau();
    requestAnimationFrame(image);
  };

  if (!boucleLancee) { boucleLancee = true; requestAnimationFrame(image); }
  peindrePanneau();
}

// ---------------------------------------------------------------------------
// Affichage des fiches
// ---------------------------------------------------------------------------

function nomLieu(partie: Partie, p: Personnage): string {
  const a = p.activite;
  if (a !== null && a.type === 'deplacement') {
    return `en chemin vers ${partie.monde.lieux.get(a.vers)?.nom ?? '…'}`;
  }
  return partie.monde.lieux.get(p.position.lieu)?.nom ?? '—';
}

function resumeActivite(partie: Partie, p: Personnage): string {
  const a = p.activite;
  const quoi = a === null ? 'décide' : a.type === 'deplacement' ? 'se déplace' : a.action.replace(/_/g, ' ');
  return `${p.prenom} — ${quoi} · ${nomLieu(partie, p)}`;
}

function ficheHtml(partie: Partie, p: Personnage): string {
  const poste = posteDe(partie.monde, p);
  const chezSoi = partie.monde.lieux.get(domicile(partie.monde, p) ?? (0 as never))?.nom ?? '—';
  const a = p.activite;
  const quoi = a === null ? 'décide' : a.type === 'deplacement' ? 'se déplace' : a.action.replace(/_/g, ' ');

  const jauge = (nom: string, v: number): string => `
    <div class="jauge"><span>${nom}</span>
      <i style="--part:${Math.round((v / 1000) * 100)}%"></i>
      <b>${Math.round(v / 10)}</b>
    </div>`;

  const caractere = (['sociabilite', 'ambition', 'impulsivite', 'discipline'] as const)
    .map((t) => `<li>${t} <b>${trait(p, t) > 0 ? '+' : ''}${trait(p, t)}</b></li>`).join('');

  return `
    <header>
      <h2>${nomComplet(p)}${p.id === partie.joueur ? ' <em>(vous)</em>' : ''}</h2>
      <p>${age(p.naissance, partie.monde.tick)} ans · ${poste?.intitule ?? 'sans occupation'}</p>
    </header>
    <dl>
      <dt>en ce moment</dt><dd>${quoi}</dd>
      <dt>se trouve</dt><dd>${nomLieu(partie, p)}</dd>
      <dt>habite</dt><dd>${chezSoi}</dd>
      ${poste === undefined ? '' : `<dt>horaires</dt><dd>${poste.debutH} h – ${poste.finH} h</dd>`}
      <dt>argent</dt><dd>${p.argent} €</dd>
    </dl>
    <h3>Besoins</h3>
    ${BESOINS.map((b) => jauge(b, besoin(p, b))).join('')}
    <h3>Tempérament</h3>
    <ul class="traits">${caractere}</ul>`;
}

menu();

/**
 * L'écran de création du personnage.
 *
 * Il produit une `FicheCreation` — rien d'autre. Aucun monde n'existe encore
 * quand il s'affiche, et c'est volontaire : on choisit qui l'on est avant
 * d'entrer, pas après.
 *
 * L'aperçu dessine la MÊME silhouette que le jeu, avec la même fonction et la
 * même `Apparence`. Ce qu'on voit en réglant les curseurs est exactement ce
 * qui marchera dans les rues.
 */

import type { Apparence } from '../etat/apparence.ts';
import { ACCESSOIRES, REPERTOIRES } from '../etat/apparence.ts';
import type { Trait } from '../etat/personnage.ts';
import type { FicheCreation } from './joueur.ts';
import { dessinerHabitant } from './silhouette.ts';

const PRENOMS_F = ['Sarah', 'Julie', 'Amina', 'Claire', 'Léa', 'Fatou', 'Inès', 'Awa'];
const PRENOMS_M = ['Paul', 'Marc', 'Ibrahim', 'Thomas', 'Karim', 'Lucas', 'Samir', 'Théo'];
const NOMS = ['Bernard', 'Diallo', 'Moreau', 'Benali', 'Traoré', 'Haddad', 'Camara', 'Perrin'];

/** Les quatre traits qu'on laisse choisir. Les dix autres sont tirés au sort. */
const TRAITS_OFFERTS: { cle: Trait; libelle: string; aide: string }[] = [
  { cle: 'sociabilite', libelle: 'Sociabilité', aide: 'cherche les autres, souffre de la solitude' },
  { cle: 'ambition', libelle: 'Ambition', aide: 'travaille plus, sacrifie du temps' },
  { cle: 'impulsivite', libelle: 'Impulsivité', aide: 'décide au feeling plutôt qu\'au mieux' },
  { cle: 'discipline', libelle: 'Discipline', aide: 'tient ses horaires, fait du sport' },
];

export function ficheParDefaut(): FicheCreation {
  return {
    prenom: 'Camille',
    nom: 'Moreau',
    age: 22,
    sexe: 'f',
    apparence: {
      genes: { teintePeau: 90, teinteCheveux: 70, coiffure: 2, corpulence: 0, tailleCm: 170 },
      garderobe: { haut: 1, bas: 2, teinteHaut: 150, teinteBas: 30 },
      accessoires: 0,
    },
    traits: { sociabilite: 20, ambition: 0, impulsivite: 0, discipline: 10 },
  };
}

export function ecranCreation(
  hote: HTMLElement,
  valider: (fiche: FicheCreation) => void,
): void {
  const fiche = ficheParDefaut();

  hote.innerHTML = `
    <div class="creation">
      <div class="creation-apercu">
        <canvas id="apercu" width="260" height="320"></canvas>
        <p class="apercu-nom" id="apercu-nom"></p>
      </div>
      <div class="creation-reglages">
        <h1>Qui êtes-vous ?</h1>
        <p class="sous">Vous entrerez dans le quartier comme n'importe quel habitant : un logement, peut-être un travail, et des voisins qui ne vous ont pas attendu.</p>

        <div class="ligne">
          <label>Prénom <input id="prenom" type="text" maxlength="18" value="${fiche.prenom}"></label>
          <label>Nom <input id="nom" type="text" maxlength="18" value="${fiche.nom}"></label>
          <button id="des" class="secondaire" type="button" title="Tirer au sort">Au hasard</button>
        </div>

        <div class="ligne">
          <label>Âge <input id="age" type="range" min="16" max="70" value="${fiche.age}"><output id="age-val"></output></label>
          <label>Silhouette
            <select id="sexe">
              <option value="f">féminine</option>
              <option value="m">masculine</option>
            </select>
          </label>
        </div>

        <h2>Apparence</h2>
        <div class="grille">
          <label>Peau <input id="peau" type="range" min="0" max="255" value="${fiche.apparence.genes.teintePeau}"></label>
          <label>Cheveux <input id="cheveux" type="range" min="0" max="255" value="${fiche.apparence.genes.teinteCheveux}"></label>
          <label>Coiffure <input id="coiffure" type="range" min="0" max="${REPERTOIRES.coiffures - 1}" value="${fiche.apparence.genes.coiffure}"></label>
          <label>Corpulence <input id="corpulence" type="range" min="-100" max="100" value="${fiche.apparence.genes.corpulence}"></label>
          <label>Taille <input id="taille" type="range" min="145" max="200" value="${fiche.apparence.genes.tailleCm}"><output id="taille-val"></output></label>
          <label>Haut <input id="haut" type="range" min="0" max="${REPERTOIRES.hauts - 1}" value="${fiche.apparence.garderobe.haut}"></label>
          <label>Couleur du haut <input id="cHaut" type="range" min="0" max="255" value="${fiche.apparence.garderobe.teinteHaut}"></label>
          <label>Bas <input id="bas" type="range" min="0" max="${REPERTOIRES.bas - 1}" value="${fiche.apparence.garderobe.bas}"></label>
          <label>Couleur du bas <input id="cBas" type="range" min="0" max="255" value="${fiche.apparence.garderobe.teinteBas}"></label>
        </div>

        <h2>Accessoires</h2>
        <div class="cases" id="accessoires">
          ${ACCESSOIRES.map((a, i) => `<label><input type="checkbox" data-bit="${i}"> ${a}</label>`).join('')}
        </div>

        <h2>Tempérament</h2>
        <div class="grille">
          ${TRAITS_OFFERTS.map((t) => `
            <label title="${t.aide}">${t.libelle}
              <input id="t-${t.cle}" type="range" min="-100" max="100" value="${fiche.traits[t.cle] ?? 0}">
            </label>`).join('')}
        </div>
        <p class="sous petite">Le reste de votre caractère est tiré au sort, comme pour tout le monde.</p>

        <button id="entrer" class="primaire" type="button">Entrer dans le quartier</button>
      </div>
    </div>`;

  const toile = hote.querySelector<HTMLCanvasElement>('#apercu');
  const ctx = toile?.getContext('2d') ?? null;
  const el = <T extends HTMLElement>(id: string): T | null => hote.querySelector<T>(`#${id}`);

  const lire = (): void => {
    const val = (id: string): number => Number(el<HTMLInputElement>(id)?.value ?? 0);
    fiche.prenom = el<HTMLInputElement>('prenom')?.value ?? fiche.prenom;
    fiche.nom = el<HTMLInputElement>('nom')?.value ?? fiche.nom;
    fiche.age = val('age');
    fiche.sexe = (el<HTMLSelectElement>('sexe')?.value ?? 'f') === 'm' ? 'm' : 'f';
    fiche.apparence = {
      genes: {
        teintePeau: val('peau'),
        teinteCheveux: val('cheveux'),
        coiffure: val('coiffure'),
        corpulence: val('corpulence'),
        tailleCm: val('taille'),
      },
      garderobe: {
        haut: val('haut'), bas: val('bas'),
        teinteHaut: val('cHaut'), teinteBas: val('cBas'),
      },
      accessoires: [...hote.querySelectorAll<HTMLInputElement>('#accessoires input')]
        .reduce((m, c, i) => (c.checked ? m | (1 << i) : m), 0),
    };
    for (const t of TRAITS_OFFERTS) fiche.traits[t.cle] = val(`t-${t.cle}`);
  };

  const peindre = (): void => {
    const ageVal = el('age-val');
    if (ageVal !== null) ageVal.textContent = `${fiche.age} ans`;
    const tailleVal = el('taille-val');
    if (tailleVal !== null) tailleVal.textContent = `${fiche.apparence.genes.tailleCm} cm`;
    const nom = el('apercu-nom');
    if (nom !== null) nom.textContent = `${fiche.prenom} ${fiche.nom}`;

    if (ctx === null || toile === null) return;
    ctx.clearRect(0, 0, toile.width, toile.height);
    const fond = ctx.createLinearGradient(0, 0, 0, toile.height);
    fond.addColorStop(0, '#DCE5E9');
    fond.addColorStop(1, '#BCC9CE');
    ctx.fillStyle = fond;
    ctx.fillRect(0, 0, toile.width, toile.height);
    // Même fonction de dessin que dans la ville, à une échelle plus généreuse.
    dessinerHabitant(ctx, fiche.apparence as Apparence, toile.width / 2, toile.height - 40, 8, {
      age: fiche.age, phase: 0, sens: 1, obscurite: 0, selectionne: false, accent: '#5FB0E8',
    });
  };

  hote.addEventListener('input', () => { lire(); peindre(); });
  hote.addEventListener('change', () => { lire(); peindre(); });

  el<HTMLButtonElement>('des')?.addEventListener('click', () => {
    const au = <T,>(t: readonly T[]): T => t[Math.floor(Math.random() * t.length)] as T;
    const mettre = (id: string, v: number | string): void => {
      const champ = el<HTMLInputElement>(id);
      if (champ !== null) champ.value = String(v);
    };
    const feminin = Math.random() < 0.5;
    mettre('prenom', au(feminin ? PRENOMS_F : PRENOMS_M));
    mettre('nom', au(NOMS));
    const sexe = el<HTMLSelectElement>('sexe');
    if (sexe !== null) sexe.value = feminin ? 'f' : 'm';
    mettre('peau', Math.floor(Math.random() * 256));
    mettre('cheveux', Math.floor(Math.random() * 256));
    mettre('coiffure', Math.floor(Math.random() * REPERTOIRES.coiffures));
    mettre('corpulence', Math.floor(Math.random() * 201) - 100);
    mettre('taille', 150 + Math.floor(Math.random() * 45));
    mettre('haut', Math.floor(Math.random() * REPERTOIRES.hauts));
    mettre('bas', Math.floor(Math.random() * REPERTOIRES.bas));
    mettre('cHaut', Math.floor(Math.random() * 256));
    mettre('cBas', Math.floor(Math.random() * 256));
    lire(); peindre();
  });

  el<HTMLButtonElement>('entrer')?.addEventListener('click', () => { lire(); valider(fiche); });

  lire();
  peindre();
}

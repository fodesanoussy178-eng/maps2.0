/**
 * Les courbes de réponse.
 *
 * Une courbe transforme un état du monde en une valeur d'utilité dans [0, 1].
 * C'est la brique dont tout le comportement est fait : régler un personnage,
 * c'est choisir des courbes, pas écrire des conditions.
 *
 * La différence est plus profonde qu'il n'y paraît. Une condition
 * (« si faim > 700 alors manger ») produit un agent qui bascule d'un
 * comportement à l'autre au passage d'un seuil, toujours au même endroit, de
 * manière visible et répétitive. Une courbe produit une pression continue,
 * qui entre en concurrence avec les autres et perd parfois — ce qui donne un
 * personnage qui remet son repas à plus tard parce qu'il discute, et qui
 * finit par y aller.
 */

const borner = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Identité bornée. La pression se traduit directement en utilité. */
export function lineaire(x: number): number {
  return borner(x);
}

/**
 * Quadratique : indifférent tant que c'est bas, impérieux quand c'est haut.
 * La bonne forme pour la faim et le sommeil — on ne mange pas parce qu'on a
 * un peu faim.
 */
export function quadratique(x: number): number {
  const v = borner(x);
  return v * v;
}

/** Racine : compte dès le début puis sature. La forme du besoin social. */
export function racine(x: number): number {
  return Math.sqrt(borner(x));
}

/** Décroissante : l'utilité tombe quand la valeur monte. */
export function inverse(x: number): number {
  return 1 - borner(x);
}

/**
 * Sigmoïde centrée sur un seuil. Sert quand il existe vraiment un basculement
 * (les heures d'ouverture, l'argent disponible) mais qu'on ne veut pas d'une
 * marche franche, qui rendrait le comportement prévisible à la minute près.
 */
export function seuil(x: number, centre = 0.5, raideur = 12): number {
  return 1 / (1 + Math.exp(-raideur * (x - centre)));
}

/**
 * Cloche. La forme des créneaux : les repas, le sommeil, les heures de
 * bureau. `largeur` est l'écart-type, exprimé dans la même unité que `x`.
 */
export function cloche(x: number, centre: number, largeur: number): number {
  const d = (x - centre) / largeur;
  return Math.exp(-0.5 * d * d);
}

/**
 * Cloche circulaire sur 24 heures : 23 h et 1 h sont à deux heures l'une de
 * l'autre, pas à vingt-deux. Sans cela, dormir à minuit devient impossible —
 * l'erreur classique, et invisible tant qu'on ne regarde pas les nuits.
 */
export function clocheHoraire(heure: number, centre: number, largeur: number): number {
  let d = Math.abs(heure - centre);
  if (d > 12) d = 24 - d;
  return cloche(d, 0, largeur);
}

/**
 * Urgence : la courbe des besoins VITAUX — manger, dormir.
 *
 * Quasi nulle sous 30 % de pression, elle bascule vers 45 % et sature
 * ensuite. C'est ce qui manquait au premier réglage du banc d'essai : avec
 * une racine, un besoin de confort satisfait à 90 % valait encore 0,32
 * d'utilité, et « se détendre chez soi » battait « manger » chez un habitant
 * affamé. Les habitants passaient 37 % de leur temps au-dessus du seuil
 * critique de faim.
 *
 * La leçon est générale et vaut d'être retenue : dans une IA d'utilité, ce
 * n'est presque jamais le poids d'une action qui est mal réglé, c'est la
 * FORME de sa courbe aux valeurs basses.
 */
export function urgence(x: number): number {
  return seuil(x, 0.45, 9);
}

/**
 * Prévoyance : la courbe des besoins qu'on ANTICIPE.
 *
 * Toute pression ne se vit pas de la même façon. On ne va pas faire ses
 * courses parce qu'on n'a plus rien à manger : on y va parce qu'il n'y en a
 * plus pour longtemps. Avec la courbe d'urgence, les habitants attendaient
 * d'être à court, et le besoin de provisions passait un tiers du temps
 * au-dessus du seuil critique — un rythme d'achats pourtant exactement
 * correct, mais déclenché trop tard.
 *
 * La différence entre `urgence` et `prevoyance` n'est pas un réglage : c'est
 * la distinction entre un besoin qui fait mal et un besoin qui se prépare.
 */
export function prevoyance(x: number): number {
  return seuil(x, 0.32, 11);
}

/**
 * La fenêtre de nuit.
 *
 * Une cloche horaire ne sait pas exprimer « on peut se coucher à 22 h ou à
 * 1 h, mais pas à 19 h » : elle est symétrique, donc toute largeur qui rend
 * 1 h du matin plausible rend 19 h plausible aussi. Le banc d'essai l'a
 * montré sans ambiguïté — les habitants se couchaient à 20 h, se réveillaient
 * à 4 h, s'épuisaient dès 17 h et compensaient par deux heures de sieste.
 *
 * D'où cette fenêtre asymétrique, nulle avant 20 h, pleine de 22 h à 5 h, et
 * qui retombe jusqu'à 7 h.
 */
export function fenetreNuit(heure: number): number {
  if (heure >= 23 || heure < 6) return 1;
  if (heure >= 21) return (heure - 21) / 2;
  if (heure < 8) return 1 - (heure - 6) / 2;
  return 0;
}

/** Constante, pour poser une utilité de base sans condition. */
export function constante(v: number): number {
  return borner(v);
}

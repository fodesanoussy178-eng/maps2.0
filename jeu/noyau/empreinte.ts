/**
 * Empreinte d'état.
 *
 * Le déterminisme est une intention tant qu'il n'est pas un test. Quatre
 * règles de discipline (pas de `Math.random`, pas d'horloge système, pas
 * d'itération sur un `Set`, entiers seulement) protègent la simulation, mais
 * elles seront violées un jour, par distraction, dans un module lointain.
 *
 * `empreinte` est le filet : on simule trente jours deux fois et on compare
 * un seul nombre. Si un champ diverge, le test tombe le jour même, et non
 * six mois plus tard sur une partie de trente ans qu'on ne sait plus rejouer.
 *
 * La sérialisation est canonique : les clés d'objet sont triées, les `Map` et
 * les `Set` sont triés par clé. Deux mondes équivalents mais construits dans
 * un ordre différent donnent donc la même empreinte — c'est voulu : on teste
 * l'état, pas l'ordre d'insertion.
 */

const FNV_PREMIER = 0x01000193;

function absorber(h: number, texte: string): number {
  let acc = h;
  for (let i = 0; i < texte.length; i += 1) {
    acc = Math.imul(acc ^ texte.charCodeAt(i), FNV_PREMIER) >>> 0;
  }
  return acc >>> 0;
}

function serialiser(valeur: unknown, profondeur: number): string {
  if (profondeur > 32) return '…';
  if (valeur === null) return 'n';
  if (valeur === undefined) return 'u';

  switch (typeof valeur) {
    case 'boolean':
      return valeur ? 'T' : 'F';
    case 'number':
      // Les flottants ne doivent pas entrer dans l'état de la simulation. Si
      // l'un s'y glisse, on le fige à six décimales pour que l'empreinte
      // reste stable malgré les arrondis — et on le rend visible par le
      // préfixe, pour pouvoir le traquer.
      return Number.isInteger(valeur) ? `i${valeur}` : `f${valeur.toFixed(6)}`;
    case 'string':
      return `s${valeur}`;
    case 'bigint':
      return `b${valeur.toString()}`;
    default:
      break;
  }

  if (Array.isArray(valeur)) {
    return `[${valeur.map((v) => serialiser(v, profondeur + 1)).join(',')}]`;
  }

  if (valeur instanceof Map) {
    const entrees = Array.from(valeur.entries())
      .map(([c, v]) => [serialiser(c, profondeur + 1), serialiser(v, profondeur + 1)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `M{${entrees.map(([c, v]) => `${c}:${v}`).join(',')}}`;
  }

  if (valeur instanceof Set) {
    const elements = Array.from(valeur.values())
      .map((v) => serialiser(v, profondeur + 1))
      .sort();
    return `S{${elements.join(',')}}`;
  }

  if (ArrayBuffer.isView(valeur) && !(valeur instanceof DataView)) {
    return `A[${Array.from(valeur as unknown as ArrayLike<number>).join(',')}]`;
  }

  const objet = valeur as Record<string, unknown>;
  const clefs = Object.keys(objet).sort();
  return `{${clefs.map((c) => `${c}:${serialiser(objet[c], profondeur + 1)}`).join(',')}}`;
}

/** Empreinte hexadécimale sur 8 caractères. */
export function empreinte(valeur: unknown): string {
  const h = absorber(0x811c9dc5, serialiser(valeur, 0));
  return h.toString(16).padStart(8, '0');
}

/**
 * Forme sérialisée canonique. Quand deux empreintes diffèrent, c'est ceci
 * qu'on compare pour trouver le champ fautif — d'où le fait qu'elle soit
 * lisible plutôt que compacte.
 */
export function formeCanonique(valeur: unknown): string {
  return serialiser(valeur, 0);
}

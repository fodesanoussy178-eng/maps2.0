/* ---------------------------------------------------------------------------
   LES COORDONNÉES, NORMALISÉES — UNE SEULE FOIS POUR TOUTES LES SOURCES

   Un numéro de téléphone, une adresse électronique et une URL se valident de
   la même façon quel que soit l'agenda qui les publie : la contrainte E.164
   de `events.phone` ne change pas de forme selon la source, et une URL qu'on
   n'ose pas afficher pour OpenAgenda ne devient pas sûre parce qu'elle vient
   de DATAtourisme.

   Ces trois fonctions vivaient dans `sync-openagenda/contacts.mjs`, où elles
   ont été écrites. Elles n'en sortent pas modifiées : DATAtourisme publie lui
   aussi des coordonnées (`hasContact`, `hasBookingContact`) et devait les
   normaliser exactement pareil, sinon deux sources auraient deux définitions
   du même « numéro valide » — et la base, une contrainte à faire respecter
   par les deux.

   Le repêchage dans du texte libre, lui, reste chez OpenAgenda : c'est un
   choix propre à une source qui écrit ses coordonnées en prose.
--------------------------------------------------------------------------- */

/* La forme exigée par `events_phone_e164` : un « + », un premier chiffre non
   nul, puis 6 à 14 chiffres. Tout ce qui sort d'ici la respecte, ou est nul. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

/* `(0)` est une convention typographique française — « +33 (0)3 20 … » — pas
   un chiffre du numéro. Elle disparaît avant toute lecture. */
export const INDICATIF_PARENTHESE = /\(\s*0\s*\)/g;

/* Le motif demandé : indicatif +33 ou 0, un premier chiffre non nul, quatre
   paires. Les séparateurs admis excluent « / » et « : » pour ne pas ramasser
   des dates ou des horaires. */
export const TELEPHONE_FR = /(?<![\d+/:])(?:\+33[ .\-]{0,2}|0)[1-9](?:[ .\-]?\d{2}){4}(?!\d)/g;


/* Une valeur OpenAgenda est souvent multilingue : `{fr: "…"}`. On lit la même
   cascade que `normalize.mjs`, en local, pour que ce module reste testable
   sans rien importer de la chaîne de synchronisation. */
export function texteBrut(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(texteBrut).find(Boolean) || "";
  if (typeof value === "object") {
    for (const cle of ["fr", "@value", "value", "label", "name", "text", "content", "url", "link"]) {
      if (value[cle] != null) {
        const trouve = texteBrut(value[cle]);
        if (trouve) return trouve;
      }
    }
  }
  return "";
}

/* --------------------------------------------------------------------------
   NORMALISER UN NUMÉRO — ou rendre null
   ------------------------------------------------------------------------ */
export function telephoneE164(valeur) {
  const brut = texteBrut(valeur).replace(INDICATIF_PARENTHESE, " ").trim();
  if (!brut) return null;
  const chiffres = brut.replace(/\D/g, "");
  if (!chiffres) return null;

  let e164 = null;
  if (brut.startsWith("+")) e164 = `+${chiffres}`;
  else if (chiffres.startsWith("00")) e164 = `+${chiffres.slice(2)}`;
  else if (/^0[1-9]\d{8}$/.test(chiffres)) e164 = `+33${chiffres.slice(1)}`;
  else if (/^33[1-9]\d{8}$/.test(chiffres)) e164 = `+${chiffres}`;
  else return null;

  /* Un « +33 0 3 20 … » recopié tel quel donnerait « +3303204750 60 » : la
     forme générale E.164 l'accepterait, la France non. On vérifie le plan de
     numérotation quand l'indicatif est le nôtre ; pour les autres pays on
     s'en tient à la forme, faute de savoir. */
  if (e164.startsWith("+33") && !/^\+33[1-9]\d{8}$/.test(e164)) return null;
  return E164.test(e164) ? e164 : null;
}

/* -------------------------------------------------------------------------- */
export function urlPropre(valeur) {
  const brut = texteBrut(valeur).trim().replace(/[.,;:!?»"'’)]+$/, "");
  if (!/^https?:\/\/\S+$/i.test(brut)) return null;
  if (brut.length > 500) return null;
  try {
    const url = new URL(brut);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function courrielPropre(valeur) {
  const brut = texteBrut(valeur).trim().replace(/^mailto:/i, "").split(/[?\s]/)[0].toLowerCase();
  if (!brut || brut.length > 320) return null;
  return /^[a-z0-9._%+\-]+@[a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?\.[a-z]{2,}$/.test(brut) ? brut : null;
}

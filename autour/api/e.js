/* ===========================================================================
   /e/<id> — LA PAGE D'UNE PUBLICATION, AVEC SON APERÇU

   Un lien Autour collé dans WhatsApp, Messages ou Messenger affichait la
   vignette générique de l'application : `/e/<id>` était servi par le même
   `index.html` statique, et les robots d'aperçu n'exécutent pas de JavaScript.

   Cette route rend EXACTEMENT la même page — l'application s'y ouvre comme
   avant, sur la bonne publication —, mais son <head> porte le titre, la date,
   le lieu, le nombre de participants et l'affiche de la publication.

   CE QUI N'Y ENTRE JAMAIS : le créateur, un contact, une donnée privée. On lit
   la même fonction publique que l'application (`publication_publique`), qui
   écarte déjà une publication masquée par signalements. Tout ce qui vient d'un
   habitant est échappé avant d'entrer dans un attribut.

   Si quoi que ce soit échoue — identifiant invalide, base injoignable,
   publication absente —, la page est servie telle quelle : un lien partagé
   s'ouvre toujours.
   ======================================================================== */

export const config = { runtime: "edge" };

const SUPABASE_URL = (typeof process !== "undefined" && process.env && process.env.SUPABASE_URL) ||
  "https://sxnzyvcgwbwnpjnqmpkp.supabase.co";
const SUPABASE_CLE = (typeof process !== "undefined" && process.env && process.env.SUPABASE_ANON_KEY) ||
  "sb_publishable_T4_3er0DEI9vX4YdEhPDIw_m3yV_FlM";
const SITE = "https://autour.eu";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function echapper(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const EMOJI = { event: "🎉", sport: "⚽", rencontre: "👥", popup: "✨", food: "🍜",
  collecte: "📦", studio: "🎧", autre: "📍" };

/* Une date ABSOLUE : un aperçu est mis en cache par les messageries, et
   « Aujourd'hui » serait faux dès le lendemain. */
export function quandAbsolu(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const f = (o) => new Intl.DateTimeFormat("fr-FR", Object.assign({ timeZone: "Europe/Paris" }, o))
    .format(new Date(t));
  const jour = f({ weekday: "short", day: "numeric", month: "short" });
  const heure = f({ hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .replace(":", "h").replace(/h00$/, "h");
  return jour + " · " + heure;
}

export function balisesApercu(p, etat, url) {
  const titre = (EMOJI[p.cat] ? EMOJI[p.cat] + " " : "") + String(p.titre || "Autour").slice(0, 80);
  const bouts = [quandAbsolu(p.debut_le), p.adresse].filter(Boolean);
  if (etat && Number.isFinite(etat.participants)) {
    if (etat.places != null) bouts.push(etat.participants + "/" + etat.places + " participants");
    else if (etat.participants > 0) bouts.push(etat.participants + " participant" + (etat.participants > 1 ? "s" : ""));
  }
  if (p.annule || p.status === "cancelled") bouts.unshift("Annulé");
  const description = (bouts.join(" · ") + " — Voir sur Autour").slice(0, 200);
  const image = /^https:\/\//.test(p.image_url || "") ? p.image_url : SITE + "/og.png";
  return {
    titre, description, image, url,
    html:
      '<meta property="og:type" content="article" />\n' +
      '<meta property="og:site_name" content="Autour" />\n' +
      '<meta property="og:title" content="' + echapper(titre) + '" />\n' +
      '<meta property="og:description" content="' + echapper(description) + '" />\n' +
      '<meta property="og:url" content="' + echapper(url) + '" />\n' +
      '<meta property="og:image" content="' + echapper(image) + '" />\n' +
      '<meta property="og:image:alt" content="' + echapper(titre) + '" />\n' +
      '<meta name="twitter:card" content="summary_large_image" />\n' +
      '<meta name="twitter:title" content="' + echapper(titre) + '" />\n' +
      '<meta name="twitter:description" content="' + echapper(description) + '" />\n' +
      '<meta name="twitter:image" content="' + echapper(image) + '" />\n' +
      '<meta name="description" content="' + echapper(description) + '" />\n' +
      '<link rel="canonical" href="' + echapper(url) + '" />\n',
  };
}

/* Retire les balises génériques que la page porte déjà, puis pose celles de
   la publication : un aperçu ne doit jamais hésiter entre deux titres. */
export function injecter(page, balises) {
  const nettoyee = page
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+|description)"[^>]*>\s*/g, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/g, "")
    .replace(/<title>[\s\S]*?<\/title>/, "<title>" + echapper(balises.titre) + " · Autour</title>");
  return nettoyee.replace("</head>", balises.html + "</head>");
}

async function rpc(nom, corps) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + nom, {
    method: "POST",
    headers: { apikey: SUPABASE_CLE, "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
  if (!r.ok) throw new Error(nom + " " + r.status);
  return r.json();
}

export default async function handler(requete) {
  const adresse = new URL(requete.url);
  const id = adresse.searchParams.get("id") || "";
  /* Les cookies suivent : sur un déploiement de prévisualisation protégé,
     sans eux, la page lue serait l'écran de connexion de Vercel. */
  const lue = await fetch(new URL("/index.html", adresse.origin),
    { headers: { cookie: requete.headers.get("cookie") || "" } });
  const page = await lue.text();
  const entetes = { "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
  // ce n'est pas la page d'Autour : on la rend telle quelle, sans rien y poser
  if (!lue.ok || !page.includes('id="navBas"'))
    return new Response(page, { status: lue.status, headers: { "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store" } });
  if (!UUID.test(id)) return new Response(page, { headers: entetes });
  try {
    const [p] = await rpc("publication_publique", { p_id: id });
    if (!p) return new Response(page, { headers: entetes });
    let etat = null;
    try { [etat] = await rpc("participation_publications", { p_ids: [id] }); } catch (e) { etat = null; }
    const balises = balisesApercu(p, etat, SITE + "/e/" + id);
    return new Response(injecter(page, balises), { headers: entetes });
  } catch (e) {
    return new Response(page, { headers: entetes });
  }
}

/* ===========================================================================
   L'APERÇU DANS CHATGPT — TROIS CARTES, ET C'EST TOUT

   Ce n'est pas une petite version d'Autour. C'est un APERÇU : de quoi voir
   qu'un résultat est pertinent, et un bouton pour aller le vivre. Pas de
   carte interactive, pas de filtres, pas de favoris, pas de navigation —
   tout cela existe déjà, mieux, dans Autour, et le dupliquer ici coûterait
   deux fois le travail pour une expérience moins bonne.

   CE QUE CHAQUE CARTE MONTRE, ET POURQUOI CHAQUE CHAMP Y EST :
     · l'image, quand elle existe et qu'elle est autorisée — sinon rien, jamais
       un visuel de remplacement (une affiche prise ailleurs serait un mensonge) ;
     · le nom, tel que l'organisateur l'écrit ;
     · le type et la date, qui disent si c'est pour aujourd'hui ;
     · la distance, qui dit si c'est atteignable ;
     · une ligne de résumé, pour décider ;
     · un bouton dont le libellé dit exactement où il mène.

   POUR UN POINT DE SERVICE, le contenu change parce que la question change :
   le service rendu, l'adresse, les horaires et le téléphone passent devant
   l'image — quelqu'un qui cherche à manger ce soir n'a pas besoin d'une photo.

   AUCUNE DÉPENDANCE EXTERNE : pas de framework, pas de CDN, pas de police
   distante. Le composant est servi comme ressource MCP et doit fonctionner
   dans un bac à sable sans réseau sortant.
   ======================================================================== */

export const URI_WIDGET = "ui://widget/autour-apercu.html";
export const MIME_WIDGET = "text/html+skybridge";

export const HTML_WIDGET = `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<title>Autour — aperçu</title>
<style>
  :root {
    color-scheme: light dark;
    --fond: transparent;
    --carte: #ffffff;
    --bord: #e3e6e4;
    --texte: #16211c;
    --gris: #5d6b63;
    --accent: #0f7a5a;
    --accent-texte: #ffffff;
    --alerte: #9a3412;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --carte: #16211c; --bord: #2a3831; --texte: #eef2ef;
      --gris: #a8b5ad; --accent: #34d399; --accent-texte: #06251a;
      --alerte: #fdba74;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--fond); color: var(--texte);
    font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .liste { display: grid; gap: 10px; }
  .carte {
    display: grid; grid-template-columns: 76px 1fr; gap: 12px;
    background: var(--carte); border: 1px solid var(--bord); border-radius: 14px;
    padding: 10px; align-items: start;
  }
  .carte.sans-image { grid-template-columns: 1fr; }
  .vignette {
    width: 76px; height: 76px; border-radius: 10px; object-fit: cover;
    background: color-mix(in srgb, var(--bord) 60%, transparent);
  }
  .titre { font-weight: 650; margin: 0 0 2px; font-size: 15px; }
  .meta { color: var(--gris); font-size: 13px; margin: 0 0 4px;
          display: flex; flex-wrap: wrap; gap: 4px 8px; }
  .resume { margin: 0 0 8px; font-size: 13.5px; }
  .lien {
    display: inline-block; padding: 6px 12px; border-radius: 999px;
    background: var(--accent); color: var(--accent-texte);
    text-decoration: none; font-size: 13px; font-weight: 600;
  }
  .services { font-size: 13px; margin: 0 0 4px; }
  .note { color: var(--gris); font-size: 12.5px; margin: 8px 2px 0; }
  .prudence { color: var(--alerte); font-size: 12.5px; margin: 2px 0 6px; }
  .vide { color: var(--gris); font-size: 14px; padding: 6px 2px; }
  .global { margin-top: 10px; }
  .credit { color: var(--gris); font-size: 11px; margin: 2px 0 0; }
</style>
<div id="racine" class="liste"></div>
<script>
(function () {
  "use strict";
  var racine = document.getElementById("racine");

  function texte(valeur) {
    return String(valeur == null ? "" : valeur);
  }
  function el(nom, classe, contenu) {
    var noeud = document.createElement(nom);
    if (classe) noeud.className = classe;
    if (contenu != null) noeud.textContent = texte(contenu);
    return noeud;
  }
  function distance(metres) {
    if (typeof metres !== "number" || !isFinite(metres)) return null;
    return metres < 1000 ? Math.round(metres) + " m"
      : (metres / 1000).toFixed(1).replace(".", ",") + " km";
  }

  /* Le bouton passe par \`window.openai.openExternal\` quand l'hôte le fournit —
     c'est lui qui sait ouvrir un lien hors du cadre. Sinon, un lien ordinaire :
     un aperçu ne doit jamais devenir un cul-de-sac parce qu'une API manque. */
  function bouton(url, libelle) {
    var lien = el("a", "lien", libelle || "Ouvrir dans Autour");
    lien.href = url;
    lien.target = "_blank";
    lien.rel = "noopener noreferrer";
    lien.addEventListener("click", function (evenement) {
      var api = window.openai;
      if (api && typeof api.openExternal === "function") {
        evenement.preventDefault();
        api.openExternal({ href: url });
      }
    });
    return lien;
  }

  function carteEvenementOuLieu(item) {
    var carte = el("div", item.image && item.image.url ? "carte" : "carte sans-image");
    if (item.image && item.image.url) {
      var img = document.createElement("img");
      img.className = "vignette";
      img.src = item.image.url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () { img.remove(); carte.className = "carte sans-image"; });
      carte.appendChild(img);
    }
    var corps = el("div");
    corps.appendChild(el("p", "titre", item.name));
    var meta = el("div", "meta");
    [item.type_label || item.type, item.date_label || item.opening_label,
      distance(item.distance_m), item.city, item.price_text]
      .filter(Boolean).forEach(function (bout) { meta.appendChild(el("span", null, bout)); });
    corps.appendChild(meta);
    /* Les séances restent séparées, comme dans Autour : « 14h00 · 16h30 · 20h00 »
       et jamais une plage qui laisserait croire à une séance de six heures. */
    if (item.sessions && item.sessions.length > 1) {
      var heures = item.sessions.slice(0, 6).map(function (s) {
        try {
          return new Date(s.start).toLocaleTimeString("fr-FR",
            { hour: "2-digit", minute: "2-digit" });
        } catch (e) { return null; }
      }).filter(Boolean);
      if (heures.length) corps.appendChild(el("p", "services", "Séances : " + heures.join(" · ")));
    }
    if (item.summary) corps.appendChild(el("p", "resume", item.summary));
    if (item.reliability && item.reliability.status === "candidate")
      corps.appendChild(el("p", "prudence", "Date à confirmer auprès de l'organisateur."));
    if (item.opening_status === "unknown" && item.kind === "place")
      corps.appendChild(el("p", "prudence", "Horaires non renseignés."));
    if (item.deep_link) corps.appendChild(bouton(item.deep_link, item.cta));
    if (item.image && item.image.credit)
      corps.appendChild(el("p", "credit", "© " + item.image.credit));
    carte.appendChild(corps);
    return carte;
  }

  function cartePointDeService(item) {
    var carte = el("div", "carte sans-image");
    var corps = el("div");
    corps.appendChild(el("p", "titre", item.name));
    var meta = el("div", "meta");
    [item.services && item.services.length ? item.services.slice(0, 3).join(" · ") : null,
      distance(item.distance_m), item.city].filter(Boolean)
      .forEach(function (bout) { meta.appendChild(el("span", null, bout)); });
    corps.appendChild(meta);
    if (item.address) corps.appendChild(el("p", "services", item.address));
    if (item.hours) corps.appendChild(el("p", "services", "Horaires : " + item.hours));
    if (item.phone) corps.appendChild(el("p", "services", "Tél. " + item.phone));
    if (item.access_conditions) corps.appendChild(el("p", "resume", item.access_conditions));
    if (item.reliability && item.reliability.status !== "verified")
      corps.appendChild(el("p", "prudence", "Information non vérifiée : à confirmer avant de s'y rendre."));
    if (item.deep_link) corps.appendChild(bouton(item.deep_link, item.cta));
    carte.appendChild(corps);
    return carte;
  }

  function rendre(sortie) {
    racine.textContent = "";
    var donnees = sortie || {};
    var resultats = (donnees.results || []).slice(0, 3);
    if (donnees.result) resultats = [donnees.result];
    if (!resultats.length) {
      var lignes = (donnees.notes || []).slice(0, 2);
      racine.appendChild(el("p", "vide", lignes.length ? lignes.join(" ")
        : "Autour n'a rien de fiable à montrer ici pour le moment."));
    } else {
      resultats.forEach(function (item) {
        racine.appendChild(item && item.kind === "service_point"
          ? cartePointDeService(item) : carteEvenementOuLieu(item));
      });
      (donnees.notes || []).slice(0, 2).forEach(function (note) {
        racine.appendChild(el("p", "note", note));
      });
    }
    if (donnees.autour && donnees.autour.url) {
      var global = el("div", "global");
      global.appendChild(bouton(donnees.autour.url, donnees.autour.label));
      racine.appendChild(global);
    }
  }

  function lire() {
    var api = window.openai;
    return (api && (api.toolOutput || (api.toolResponse && api.toolResponse.structuredContent))) || null;
  }

  rendre(lire());
  /* L'hôte republie ses globales quand la réponse arrive ou que le thème
     change ; on redessine, sans rien garder d'un état précédent. */
  window.addEventListener("openai:set_globals", function () { rendre(lire()); });
  window.addEventListener("message", function (evenement) {
    var donnees = evenement && evenement.data;
    if (donnees && donnees.type === "openai:set_globals") rendre(lire());
  });
})();
</script>
</html>`;

export const RESSOURCES = Object.freeze([
  Object.freeze({
    uri: URI_WIDGET,
    name: "Autour — aperçu",
    description: "Aperçu de trois résultats Autour au maximum, avec un lien vers la vue correspondante sur autour.eu.",
    mimeType: MIME_WIDGET,
    texte: HTML_WIDGET,
  }),
]);

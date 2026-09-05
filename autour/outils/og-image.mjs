/* L'image de partage d'Autour, dessinée puis figée.

   POURQUOI UN SCRIPT PLUTÔT QU'UN FICHIER DÉPOSÉ

   `og.png` est un binaire : une fois au dépôt, personne ne sait plus comment
   il a été fait ni comment le refaire à l'identique. Le dessin vit donc ici,
   en HTML lisible et modifiable, et l'image en est la sortie.

   CE SCRIPT N'EST PAS DANS LE BUILD. Il ne tourne pas à chaque déploiement :
   l'image est stable, elle est commitée, et Vercel la sert telle quelle. On
   le relance à la main le jour où le dessin doit changer.

   Il demande Playwright et un Chromium, que la livraison n'embarque pas :
     npm i --no-save playwright-core
     node outils/og-image.mjs

   1200×630 est le format que réclament Open Graph et Twitter/X pour une
   grande carte : en dessous, l'aperçu est rogné ou dégradé en vignette.
*/

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIE = join(RACINE, "og.png");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

/* Les couleurs sont celles de `index.html` — recopiées, parce qu'une image ne
   peut pas lire une variable CSS, et vérifiées par le test du lot. */
const DESSIN = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#F7F8F5;
       font-family:"Inter Tight",Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       color:#1F2A25;overflow:hidden;position:relative}
  /* Une trame de rues très pâle : elle dit « carte » sans rien illustrer de
     faux — aucune ville reconnaissable, donc aucune promesse de couverture. */
  .trame{position:absolute;inset:0;
    background-image:
      linear-gradient(#DCE0D8 2px,transparent 2px),
      linear-gradient(90deg,#DCE0D8 2px,transparent 2px);
    background-size:84px 84px;opacity:.55}
  .voie{position:absolute;background:#E7E4DE}
  .v1{left:0;right:0;top:236px;height:26px}
  .v2{top:0;bottom:0;left:792px;width:26px}
  .parc{position:absolute;left:832px;top:286px;width:236px;height:180px;
        background:#C9E6C4;border-radius:18px}
  /* L'eau reste un coin, sous le texte : elle décore le bord, elle ne
     traverse jamais une ligne à lire. */
  .eau{position:absolute;left:-40px;bottom:-30px;width:360px;height:150px;
       background:#A5CDEA;border-radius:0 110px 0 0}
  .contenu{position:absolute;left:88px;top:128px;width:660px}
  .marque{display:flex;align-items:center;gap:18px;margin-bottom:30px}
  .pastille{width:88px;height:88px;border-radius:26px;background:#141E19;
            display:flex;align-items:center;justify-content:center;font-size:52px}
  .nom{font-size:76px;font-weight:800;letter-spacing:-.04em;line-height:1}
  h1{font-size:50px;font-weight:700;letter-spacing:-.03em;line-height:1.12}
  h1 em{font-style:normal;color:#FF4A17}
  p{margin-top:24px;font-size:26px;line-height:1.45;color:#5D6B63;max-width:585px}
  .socle{position:absolute;right:88px;bottom:56px;display:flex;align-items:center;gap:12px}
  .socle span{font-size:24px;font-weight:600;color:#1F2A25}
  .point{width:14px;height:14px;border-radius:50%;background:#FF4A17}
</style></head><body>
  <div class="trame"></div>
  <div class="voie v1"></div><div class="voie v2"></div>
  <div class="parc"></div><div class="eau"></div>
  <div class="contenu">
    <div class="marque"><div class="pastille">📍</div><div class="nom">Autour</div></div>
    <h1>Ce qui se passe <em>maintenant</em><br>dans ton quartier</h1>
    <p>Événements, aide, commerces ouverts et itinéraires.
       Sans compte, sans installation.</p>
  </div>
  <div class="socle"><div class="point"></div><span>autour.eu</span></div>
</body></html>`;

const navigateur = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const page = await navigateur.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(DESSIN, { waitUntil: "load" });
await writeFile(SORTIE, await page.screenshot({ type: "png" }));
await navigateur.close();
console.log("og.png écrite en 1200×630 :", SORTIE);

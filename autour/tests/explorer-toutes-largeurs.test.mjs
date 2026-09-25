/* EXPLORER DOIT EXISTER SUR TOUTES LES LARGEURS, ET OUVRIR CE QU'ON TOUCHE.

   Deux défauts réels, signalés depuis un ordinateur : « le truc Explorer
   marche pas, et quand on clique sur un truc dans Explorer on a pas le lieu ».
   Ils étaient indépendants, et aucun test ne pouvait les voir.

   LE PREMIER était une règle de présentation devenue une condition
   d'existence. Toute la surface de découverte vivait dans
   `@media (max-width:768px)`, avec au-dessus un `#explorerDecouverte{display:none}`
   pour « le reste ». Le code, lui, a cessé d'être borné au mobile : appuyer
   sur Explorer ouvre cette surface sur tous les écrans. Sur ordinateur et sur
   tablette l'état s'ouvrait donc correctement — `body.explorer-ouvert`,
   `hidden` retiré, contenu rempli — et le CSS gardait `display:none`. Explorer
   ne faisait rien, absolument rien, et rien ne le disait.

   LE SECOND touchait TOUTES les largeurs : appuyer sur un lieu fermait le
   panneau et déplaçait la carte, sans jamais ouvrir le lieu. Le geste
   supposait que le lieu était déjà sur la carte ; il ne l'est pas, puisque
   l'inventaire `places` et les lieux du runtime sont deux collections
   distinctes — c'est précisément ce que le lot 5 a établi.

   Le parcours réel est joué dans un navigateur par `outils/explorer.mjs`, aux
   deux largeurs. Ce fichier-ci garde les règles. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { corpsApplicationSync } from "./source.mjs";

/* `autour.css` porte les règles de style depuis qu'elles ont quitté
   `index.html` : la source lue ici reste « le document et sa feuille ». */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8") + "\n" +
  readFileSync(new URL("../autour.css", import.meta.url), "utf8");
const corps = corpsApplicationSync(import.meta.url);

/* Le CSS seul, commentaires retirés : on interroge des RÈGLES.

   Sans ce retrait, la note qui explique le défaut — et qui cite forcément la
   règle fautive — fait échouer le test censé vérifier son absence. Un test qui
   se déclenche sur sa propre explication n'apprend rien à personne. */
const css = html.slice(html.indexOf("<style"), html.lastIndexOf("</style>"))
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/* Découpe le CSS en blocs de premier niveau, en suivant les accolades. Une
   expression régulière ne sait pas dire « dans quelle media query suis-je » ;
   il faut compter. */
function mediaQueriesAutour(selecteur) {
  const dedans = [];
  const pile = [];
  let i = 0;
  while (i < css.length) {
    if (css[i] === "{") {
      const avant = css.slice(0, i);
      const debut = Math.max(avant.lastIndexOf("}"), avant.lastIndexOf("{")) + 1;
      pile.push(avant.slice(debut).trim());
      i += 1; continue;
    }
    if (css[i] === "}") { pile.pop(); i += 1; continue; }
    /* PAS DE GARDE `pile.length` ICI : une règle de premier niveau a
       justement une pile vide, et c'est elle qu'on cherche. Le garde rendait
       le test impossible à satisfaire — il n'aurait jamais été vert, quelle
       que soit la correction. */
    if (css.startsWith(selecteur, i)) {
      dedans.push(pile.filter((x) => x.startsWith("@media")));
    }
    i += 1;
  }
  return dedans;
}

test("la surface Explorer existe hors de toute media query", () => {
  /* LA RÈGLE GÉNÉRALE, et elle vaut au-delà de ce composant : une règle de
     présentation bornée à une largeur doit être un OVERRIDE, jamais une
     condition d'existence. Ce qui n'existe que sous un `@media` disparaît
     silencieusement dès que quelqu'un élargit l'usage du composant. */
  const occurrences = mediaQueriesAutour("#explorerDecouverte{");
  assert.ok(occurrences.length > 0, "aucune déclaration de #explorerDecouverte trouvée");
  assert.ok(occurrences.some((medias) => medias.length === 0),
    "#explorerDecouverte n'est déclaré que sous media query : il n'existera pas ailleurs");
});

test("aucune règle ne déclare Explorer inexistant par défaut", () => {
  /* La ligne qui causait le défaut : `#selecteurSurface,#fabCreer,
     #explorerDecouverte{display:none}`, hors media query. */
  assert.doesNotMatch(css,
    /#selecteurSurface[^{}]*#explorerDecouverte[^{}]*\{\s*display\s*:\s*none/);
  assert.doesNotMatch(css,
    /#explorerDecouverte[^{}]*#selecteurSurface[^{}]*\{\s*display\s*:\s*none/);
});

test("sur ordinateur, Explorer prend la colonne de gauche", () => {
  const desktop = css.slice(css.indexOf("@media (min-width:1100px)"));
  assert.match(desktop, /#explorerDecouverte\{[\s\S]{0,900}width:var\(--panneau\)/);
  assert.match(desktop, /#explorerDecouverte\{[\s\S]{0,900}left:var\(--marge-desktop\)/);
});

test("sur ordinateur, Explorer s'arrête au-dessus de la barre flottante", () => {
  /* `--nav-height` vaut zéro sur desktop : la barre ne POUSSE rien. Mais elle
     RECOUVRE, parce qu'une autre règle la centre sur toute la largeur. Un
     panneau qui descend jusqu'à la marge basse met donc ses dernières lignes
     derrière une barre opaque — lisibles à moitié, et inatteignables puisque
     le panneau est déjà au bout de son défilement. */
  const desktop = css.slice(css.indexOf("@media (min-width:1100px)"));
  assert.match(desktop,
    /#explorerDecouverte\{[\s\S]{0,1400}bottom:calc\(var\(--nav-flottante[^)]*\)\s*\+/);
});

test("la hauteur réservée est mesurée, jamais devinée", () => {
  /* `--nav-flottante` est republiée par `mesurerHeader()` à la hauteur réelle
     de la barre : elle dépend de la police système et du retour à la ligne des
     libellés. Un nombre écrit en dur redonnerait le défaut au premier écran
     qui ne ressemble pas à celui du développeur. */
  assert.match(corps, /document\.documentElement\.style\.setProperty\("--nav-flottante", haut\+"px"\)/);
});

test("appuyer sur un lieu d'Explorer ouvre le lieu", () => {
  /* L'ancien geste : fermer le panneau, déplacer la carte, et rien d'autre. */
  assert.doesNotMatch(corps,
    /data-xp-lieu[\s\S]{0,400}fermerExplorerDecouverte\(\);\s*\/\*[\s\S]{0,200}allerVers/);
  assert.match(corps, /function ouvrirLieuDepuisExplorer\(l\)\{/);
  assert.match(corps, /ouvrirLieuDepuisExplorer\(l\);/);
  /* Et il ouvre la fiche qui existe déjà pour tous les marqueurs : un seul
     chemin d'ouverture pour tout le produit, pas une fiche de plus. */
  const bloc = corps.slice(corps.indexOf("function ouvrirLieuDepuisExplorer"));
  assert.match(bloc.slice(0, 2600), /ouvrirFicheCompacte\(existant\)/);
});

test("le lieu ouvert entre dans la collection de la carte", () => {
  /* Sans cela, la fiche s'ouvrirait sur un objet que la carte ne connaît pas :
     pas de marqueur, pas de cœur de favori, pas de mise en avant. */
  const bloc = corps.slice(corps.indexOf("function ouvrirLieuDepuisExplorer"),
    corps.indexOf("function ouvrirLieuDepuisExplorer") + 2600);
  assert.match(bloc, /fusionner\(\[\{/);
  assert.match(bloc, /id:"place-"\+String\(l\.id\)/);
  /* On réutilise l'objet du runtime quand il existe déjà : il porte ses
     horaires, sa note et son historique. */
  assert.match(bloc, /let existant = lieux\.find/);
});

test("une famille inconnue ne se traduit pas en catégorie au hasard", () => {
  /* Une catégorie fausse suit la fiche partout — dans les filtres, la couleur
     du marqueur, le classement. Mieux vaut aucune catégorie. */
  assert.match(corps, /const CAT_PAR_FAMILLE_EXPLORER = Object\.freeze\(\{/);
  const bloc = corps.slice(corps.indexOf("function ouvrirLieuDepuisExplorer"),
    corps.indexOf("function ouvrirLieuDepuisExplorer") + 2600);
  assert.match(bloc, /CAT_PAR_FAMILLE_EXPLORER\[String\(l\.family \|\| ""\)\] \|\| null/);
});

test("les treize familles de l'inventaire ont toutes une traduction", () => {
  /* La liste vient de `place_familles`, en base. Une famille oubliée ici
     donnerait un lieu sans catégorie — donc sans couleur ni filtre. */
  ["culture", "bibliotheque", "cinema", "musique", "patrimoine", "nature", "sport",
   "marche", "restauration", "commerce", "association", "solidarite", "hebergement"]
    .forEach((famille) => assert.match(corps,
      new RegExp("CAT_PAR_FAMILLE_EXPLORER = Object\\.freeze\\(\\{[\\s\\S]{0,400}" + famille + ":"),
      famille + " n'a pas de catégorie"));
});

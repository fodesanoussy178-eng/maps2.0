# Explorer sur ordinateur — deux défauts, une même cause

> Signalé ainsi : « sur ordi j'ai l'impression le truc Explorer marche pas, et
> quand on clique sur un truc dans Explorer on a pas le lieu. »

Deux défauts indépendants, et aucun test ne pouvait les voir. C'est la partie
qui mérite d'être racontée.

## Défaut 1 — Explorer ne faisait rien, et rien ne le disait

Toute la surface de découverte vivait dans `@media (max-width:768px)`, avec
au-dessus une ligne pour « le reste » :

```css
#selecteurSurface,#fabCreer,#explorerDecouverte{display:none}
```

C'était la décision du Lot 3, écrite et assumée : *« tout ce qui suit est BORNÉ
AU MOBILE : le desktop garde sa pastille de six entrées, inchangée. »*

Mais le code, lui, a cessé d'être borné au mobile. Le gestionnaire de la barre
basse ouvre cette surface dès que l'élément existe, **quelle que soit la
largeur** :

```js
if(id === "explorer" && !document.body.classList.contains("explorer-ouvert")
   && $("#explorerDecouverte")){
  ouvrirExplorerDecouverte();
  return;                      // ← et on ne rejoint jamais le chemin desktop
}
```

Sur ordinateur et sur tablette, appuyer sur Explorer faisait donc tout
correctement — `body.explorer-ouvert` posée, `hidden` retiré, contenu rempli,
inventaire demandé — et le CSS gardait `display:none`. **Rien n'apparaissait.**
Et le `return` empêchait d'atteindre l'ancien chemin (`restaurerContexteExplorer`
/ `ouvrirAccueilFeuille`), qui, lui, fonctionnait.

Mesuré dans Chromium à 1440 px, avant correction :

```
bodyClasses               'explorer-ouvert'
explorerDecouverteHidden  false
explorerDecouverteDisplay 'none'        ← le défaut, en un mot
hauteur                   0
```

### La leçon

**Une règle de présentation bornée à une largeur doit être un OVERRIDE, jamais
une condition d'existence.** Ce qui n'existe que sous un `@media` disparaît
silencieusement le jour où quelqu'un élargit l'usage du composant — et personne
ne relit le CSS en modifiant un gestionnaire de clic.

La géométrie par défaut est donc celle du téléphone, et le desktop la redéfinit.
L'inverse de ce qui était écrit.

### Et le test qui gardait la règle

Il existait, et il est passé au vert pendant tout ce temps :

```js
test("le panneau Explorer reste une surface mobile", () => {
  assert.match(html, /#selecteurSurface,#fabCreer,#explorerDecouverte\{display:none\}/);
  assert.match(html, /@media \(max-width:768px\)[\s\S]{0,4000}#explorerDecouverte\{display:flex/);
});
```

Il vérifiait le CSS. Le JS était juste de son côté. **Aucun des deux ne
vérifiait leur cohérence** — et c'est très exactement ce qu'un test de source ne
peut pas faire.

## Défaut 2 — cliquer un lieu n'ouvrait pas le lieu

Celui-là touchait **toutes** les largeurs.

```js
fermerExplorerDecouverte();
/* On recentre sur le lieu et on laisse la carte faire son travail : ce
   lot n'invente pas une fiche de plus. */
allerVers([Number(l.lat), Number(l.lng)], 17, {duration:.6});
```

L'intention était juste — ne pas dupliquer la fiche. Mais elle supposait que le
lieu était **déjà sur la carte**. Il ne l'est pas : l'inventaire `places` et les
lieux du runtime sont deux collections distinctes, et c'est précisément ce que
le Lot 5 a établi. La carte n'avait donc aucun travail à faire, et on se
retrouvait devant une carte au hasard, panneau fermé, sans rien qui dise ce
qu'on venait d'ouvrir.

**La correction ne crée toujours aucune fiche de plus** : le lieu entre dans la
collection du runtime — il devient un marqueur comme les autres — puis on ouvre
la fiche compacte qui existe déjà pour tous les marqueurs. Un seul chemin
d'ouverture pour tout le produit.

```
Palais des Beaux-Arts
Ouvert • ferme à 18:00 · 420 m
🚶 6 min  🚲 2 min
[ Y aller ]  [ Voir ]
```

Un lieu déjà connu du runtime est réutilisé tel quel plutôt que recopié : il
porte ses horaires, sa note, son cœur de favori et son historique.

Une famille inconnue **ne se traduit pas** en catégorie au hasard : une
catégorie fausse suit la fiche partout — filtres, couleur du marqueur,
classement. Mieux vaut aucune catégorie.

## La géométrie sur ordinateur

Même produit, autre disposition — la règle que le fichier applique déjà à la
barre de navigation. Sur téléphone la surface monte du bas ; sur un écran large,
une feuille pleine largeur haute de 78 % serait une bannière, pas un panneau.
Elle prend donc la boîte du panneau de gauche, celle où l'on a déjà l'habitude
de lire ce qu'on peut faire. **Le contenu ne change pas d'une ligne.**

La poignée disparaît : un panneau ancré ne se tire pas, elle suggérerait un
geste inexistant.

### Un piège mesuré plutôt que deviné

Le panneau descendait d'abord jusqu'à `--marge-desktop`, et ses dernières
thématiques passaient derrière la barre flottante. `--nav-height` vaut `0` sur
desktop, ce qui est juste — la barre ne **pousse** rien — mais elle
**recouvre** : une règle plus bas la centre sur toute la largeur (`left:50%`,
jusqu'à 1180 px), alors que la déclaration du bloc desktop, qui l'ancre à droite
du panneau, laisse croire l'inverse.

Le panneau s'arrête donc au-dessus d'elle, comme le panneau de recommandations,
qui ne la touche jamais. La hauteur réservée est `--nav-flottante`, que
`mesurerHeader()` republie à la hauteur **réelle** de la barre : elle dépend de
la police système et du retour à la ligne des libellés. Un nombre écrit en dur
redonnerait le défaut au premier écran qui ne ressemble pas à celui du
développeur.

> Première tentative : j'ai déclaré `--nav-flottante:116px` dans le `:root`
> desktop. La mesure a rendu `88px` — la variable existait déjà, posée par le
> JS, et faisait déjà exactement ce qu'il fallait. Mesurer a évité d'ajouter
> une seconde source de vérité à côté de la bonne.

## Ce qui reste mobile, et pourquoi

`#selecteurSurface` (Maintenant / Pour toi) et `#fabCreer` restent bornés au
mobile. Le desktop a ses six entrées de navigation — Maintenant, Explorer,
Créer, Pour toi, Solidarité, Profil — qui font le même travail. Les activer en
plus donnerait deux commandes pour une même action.

## Vérification

```sh
node --test tests/explorer-toutes-largeurs.test.mjs   # 9 · les règles
node outils/explorer.mjs                              # le parcours, dans Chromium
```

Le banc joue le vrai geste aux deux largeurs et vérifie neuf points, dont
« le clic ouvre le lieu » et « le lieu entre dans la carte ». **C'est lui qui
aurait attrapé les deux défauts** : les tests de source ne le pouvaient pas.

## Les tests mis à jour, et non contournés

Deux tests verrouillaient l'ancienne décision produit. Ils ont été **inversés
avec leur explication**, pas supprimés :

- `lot6-qualite-inventaire.test.mjs` · « le panneau Explorer reste une surface
  mobile » → « existe sur toutes les largeurs » ;
- `lot3-shell-mobile.test.mjs` · « tout ce que ce lot ajoute est borné au
  mobile » → vrai pour le sélecteur de surface et le bouton flottant,
  plus pour Explorer.

Un troisième a signalé un vrai coût : `index.html` doit rester sous 200 000
caractères, parce qu'il est revalidé à chaque visite là où un `.js` s'archive
pour un an. Mes commentaires CSS l'avaient fait passer à 200 940. Ils ont été
condensés — le récit détaillé vit ici, pas sur le chemin critique du réseau.

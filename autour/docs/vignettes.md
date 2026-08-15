# Vignettes : ce qui est déjà prêt, et ce qui manque

État au moment de la passe « vitesse perçue ». **Aucune intégration d'images
n'a été faite** : cette note existe pour qu'on n'ait pas à redécouvrir le
terrain le jour où on décidera de les allumer.

## Ce qui n'aura pas à être construit

L'emplacement existe déjà, aux deux endroits où une vignette aurait du sens,
et il est construit de façon à ce qu'allumer les images **ne déplace rien**.

| | carte de recommandation | ligne de résultat (`Manger`, `Explorer`) |
| --- | --- | --- |
| balise | `figure.rc-photo` | `span.ac-photo` |
| taille réservée | 74 px de haut, pleine largeur | 46 px (58 px sur grand écran) |
| repli | tuile teintée par catégorie + émoji | idem |
| image | `<img loading="lazy" decoding="async">` en surimpression | idem |
| apparition | `opacity` 0 → 1 à `onload` | idem |
| crédit | `figcaption` en surimpression | *(absent — voir plus bas)* |

Le point important est le repli : la tuile teintée **occupe déjà la place
finale**. L'image se pose par-dessus, en position absolue, et ne pousse
personne. Une liste sans images et la même liste avec images ont exactement la
même géométrie — donc allumer les vignettes ne peut pas produire de saut de
mise en page, ni pendant le chargement, ni après.

Le fond de carte n'est concerné à aucun endroit. Les vignettes appartiennent
aux contenus (recommandations, résultats, fiches) ; la carte reste claire,
grise et beige, et rien dans ce dispositif ne la touche.

## Ce qui manque réellement

Ce n'est pas de l'architecture, c'est **une source d'images affichable**.

Aujourd'hui les seules photos disponibles en nombre viennent de Google Places,
et leur licence impose un crédit visible à côté de la photo. La carte de
recommandation a la place de l'afficher (`figcaption`), la ligne de résultat
ne l'a pas — 46 px de côté ne portent pas une attribution lisible. D'où la
condition, dans le rendu des lignes :

```js
const photoVisible = l.image && !(l.imageSource === "google_places" && l.imageAttribution);
```

Ce n'est donc pas une limite technique et il ne faut pas la « corriger » : une
photo Places sans son crédit dans une liste serait un manquement à la licence.

Trois chemins possibles, le jour venu :

1. **Les publications Autour.** Une photo posée par quelqu'un du quartier
   n'a pas de contrainte d'attribution externe. C'est la voie la plus propre,
   et le champ existe déjà (`photo-champ` dans le formulaire de publication).
2. **Un catalogue ouvert** (DATAtourisme et équivalents) dont la licence
   autorise l'affichage sans crédit adjacent, ou avec un crédit groupé.
3. **Donner sa place au crédit** dans la ligne de résultat — ce qui suppose
   de revoir sa hauteur, donc le nombre de résultats visibles sans défiler.
   C'est un arbitrage produit, pas une tâche technique.

## Ce qu'il faudra vérifier le jour où on les allume

- La vignette reste **hors du chemin critique** : `loading="lazy"` et
  `decoding="async"` sont déjà là, et aucune image ne doit être attendue pour
  qu'un résultat s'affiche.
- Une image qui échoue laisse la tuile teintée en place — pas de cadre vide,
  pas de trou. C'est déjà le comportement : l'`<img>` est en surimpression et
  reste invisible tant que `onload` n'a pas ajouté `vue`.
- Le budget réseau : une liste de dix vignettes de 46 px ne doit pas peser
  plus que quelques dizaines de kilo-octets, sans quoi on reprend d'une main
  ce que la passe vitesse vient de rendre de l'autre.

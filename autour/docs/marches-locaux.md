# Marchés, brocantes, braderies, fêtes de quartier

Audit et corrections du 26/09/2026. Aucun moteur de plus : la famille entre
dans le pipeline existant — sources → normalisation (`core.js`) → statut
(`temporel.js`) → candidats et envies (`maintenant.js`).

## Normalisation (`core.js` · `familleLocale`, `joursRecurrence`)

- **Le titre décide**, la description jamais seule. En tête du titre (ou d'un
  segment : « TISSÉADE, MARCHÉ AUX TISSUS »), la famille remplace une
  catégorie de source qui ment (« Marché du Vieux-Lille » arrivait en
  `concert`). Mentionnée au détour d'un autre titre (« Concert au marché de
  Noël »), elle ne remplace qu'une catégorie vague ou absente.
- **« marche » n'est pas « marché »** : sans accent, c'est une marche à pied
  (« Marche nordique » → Sport), sauf qualificatif sans ambiguïté ou titre en
  capitales. Le marché de l'emploi, de l'immobilier, « place du Marché »,
  « foire aux questions », « Vieille Bourse » ne sont pas des marchés.
- « Ducasse » et « kermesse » sont des indices faibles.
- Une **publication d'habitant** garde le type choisi à la création ; elle
  gagne seulement la famille et les envies.

| Famille | Catégorie affichée | Famille Maintenant | Envies |
|---|---|---|---|
| marché, hebdomadaire, alimentaire, producteurs, fermier | Marchés | manger | Manger |
| marché nocturne | Marchés | sortir | Sortir, Manger |
| marché de Noël, village de Noël | Marchés | sortir | Sortir |
| marché artisanal, créateurs, aux livres | Marchés | sortir | Sortir, Culture |
| puces, marché aux puces | Marchés | sortir | Sortir |
| vide-grenier, brocante, braderie, bourse aux…, foire | Événement | sortir | Sortir |
| vente associative / solidaire / caritative | Événement | sortir | Sortir |
| fête / animation / événement de quartier, fête locale | Événement | sortir | Sortir |

Gratuit s'ajoute quand la source a écrit `is_free` (un montant à 0 avec
`is_free` n'est plus « 0 € »).

## Récurrences

DATAtourisme publie un marché hebdomadaire comme **une** plage du 1er janvier
au 31 décembre, sans jour de semaine ; les jours ne sont que dans la prose.
`joursRecurrence` les lit (« chaque mercredi, vendredi et dimanche », « du
mardi au dimanche », « sauf le lundi »). Dans `fiable()`, une longue plage
n'est « maintenant » que dans sa fenêtre horaire **et** l'un de ses jours ; un
marché récurrent dont on ne connaît aucun jour n'y entre jamais. La même règle
vaut pour « Ce week-end » (`estDansFenetre`).

## Lieux OpenStreetMap

`marche` n'est plus une « commodité » : un marché OSM **ouvert d'après ses
horaires** est une proposition comme une autre. L'horaire inconnu reste dehors.

## Limites connues

- `evenements_locaux` rend au plus 120 lignes par emprise de 5 km : au centre
  de Lille, l'horizon s'arrête à environ 6 jours. « Ce week-end » est couvert ;
  « À venir » au-delà ne l'est pas, pour toutes les catégories.
- Les tags d'annonce corrigés (`announcement-tags.mjs`) ne s'appliquent aux
  données qu'après redéploiement de la fonction de synchronisation.
- Wazemmes (mardi, jeudi, dimanche) n'annonce que « un dimanche » dans sa
  prose : il n'est proposé que le dimanche — jamais à tort.

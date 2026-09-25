# L'organisation n'est pas le point de service

*Doctrine d'Autour, posée le 25/09/2026. Elle s'applique à `local_discovery`, à
Solidarité, à la recherche, à « Pour toi », aux agents d'enrichissement, au
dédoublonnage, à la génération des fiches et à toute réponse IA future.*

## La distinction

Une **organisation** est une personne morale : un SIREN, des SIRET, un objet
déclaré. Elle sert à **vérifier** — l'identité, la provenance, l'existence
légale, l'état ouvert ou fermé.

Un **point de service** est un endroit où quelqu'un est reçu : une adresse, un
service rendu, des horaires, un téléphone, des conditions d'accès, une date de
dernière vérification. Il sert à **aider**.

Une même organisation en exploite souvent plusieurs, et la plupart n'ont aucune
existence au registre : ils sont tenus depuis la même personne morale, dans des
locaux prêtés — une salle paroissiale, une maison des services, un centre
social.

## Ce que la mesure a montré

Le registre officiel déclare, pour « LES RESTAURANTS DU COEUR » (SIREN
339863417) à Tourcoing : deux établissements, dont **un seul ouvert** (204 rue
des Cinq Voies, SIRET 33986341700053). La commune compte **cinq** centres de
distribution réels, dont les adresses sont confirmées par la Base Adresse
Nationale — 8 rue de l'Europe, 2 rue de Seclin, rue Bonne Nouvelle, avenue
Roger Salengro.

Trois points de service sur cinq n'existent donc pas au registre. Un moteur qui
raisonne en établissements en perd les trois quarts.

## L'ordre de raisonnement

Il n'est pas indicatif : c'est le seul ordre qui part du besoin et non de la
base.

```
besoin de la personne
  → service cherché
    → points de service pertinents
      → organisation de rattachement  (vérification, pas réponse)
        → distance / horaires / disponibilité / fiabilité
          → recommandation
```

**Insuffisant :** `Restos du Cœur — association départementale`.
**Attendu :** `Restos du Cœur → point de distribution X → adresse → aide
alimentaire → horaires → distance`.

## Ce qui ne fusionne jamais deux points de service

Un identifiant d'organisation **corrobore** un rapprochement ; il ne le décide
jamais. Deux points qui partagent l'un de ces signaux restent deux points tant
que leur emplacement ne dit pas le contraire :

- SIRET ;
- SIREN ;
- réseau ;
- téléphone ;
- domaine Internet.

Seuls les identifiants **de site** — un FINESS d'entité géographique, un
identifiant BAN, un identifiant OpenStreetMap — désignent un endroit et peuvent
décider seuls. Et symétriquement : deux fiches au même endroit dont les
identifiants de site diffèrent restent **deux** points, parce qu'un même
bâtiment héberge une permanence et une épicerie solidaire.

## Où la règle vit, et qui la lit

`autour/supabase/functions/shared/points-de-service.mjs` la porte une fois :

| export | rôle |
|---|---|
| `DOCTRINE_POINT_DE_SERVICE` | le bloc injecté dans les invites des agents |
| `ORDRE_DE_RAISONNEMENT` | les six étapes |
| `IDENTIFIANTS_D_ORGANISATION` | ce qui ne fusionne jamais seul |
| `IDENTIFIANTS_DE_SITE` | ce qui peut décider seul |
| `memePointDeService(a, b)` | le prédicat de dédoublonnage |
| `clePointDeService(fiche)` | la clé de publication |

Ses lecteurs :

- **`local_discovery`** — `discovery.mjs::samePlace` délègue à
  `memePointDeService` ; l'invite de `index.ts` injecte la doctrine ;
- **la publication** — `local_discovery_publier` clé sur l'adresse BAN, jamais
  sur le SIRET ;
- **Solidarité** — `aide-structures.js::compatible` traite le SIRET comme une
  corroboration ;
- **les réponses IA** — `aide-contexte-ia.js` transmet `rules`,
  `reasoningOrder`, et un candidat qui porte son adresse, son service, ses
  horaires, ses conditions d'accès et sa fraîcheur, avec son organisation
  marquée `role: "verification"`.

## Les trois violations trouvées en posant la règle

1. **`samePlace` décidait sur le SIRET seul**, et rendait immédiatement le
   résultat de la comparaison : deux points de service d'un même réseau étaient
   déclarés le même endroit quelle que soit leur adresse. Trois centres sur cinq
   étaient écrasés silencieusement, avant même que la question de la preuve se
   pose.
2. **La clé de publication était le SIRET.** Corrigée d'une première faute — une
   clé par découverte, qui multipliait les lieux — elle avait déplacé
   l'écrasement de la découverte vers l'organisation : une association à deux
   lieux de distribution n'en publiait qu'un.
3. **`aide-structures.js` rapprochait sur le SIRET** quand aucun FINESS n'était
   présent. Le SIREN était déjà exclu ; le SIRET ne l'était pas.

## Ce que la règle n'autorise pas

Publier un point de service sur la foi du nom de son réseau. Une fiche qui
envoie quelqu'un devant une porte close, un jour où il n'a rien à manger, coûte
plus qu'un écran incomplet — et personne ne la signalera. Voir
`docs/chantier-points-de-service.md` pour la preuve qui reste à construire par
point de service.

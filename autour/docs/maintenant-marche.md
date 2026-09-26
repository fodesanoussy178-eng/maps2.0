# Le futur marché de « Maintenant » — ce qui est prêt, ce qui ne l'est pas

> **Rien de commercial n'est actif.** Ce document décrit l'architecture qui
> permettra un jour de vendre de la visibilité dans Maintenant sans jamais
> vendre la sélection elle-même. Aucune table, aucune route, aucun champ
> « sponsor » n'existe aujourd'hui, et c'est voulu : un système sans client est
> un système fantôme.

## La règle, avant tout le reste

**Pertinence d'abord. Monétisation ensuite.**

Une structure pourra, plus tard, augmenter sa visibilité **parmi les candidats
déjà pertinents**. Elle ne pourra jamais contourner : la distance, la
disponibilité réelle, l'horaire, la catégorie, le contexte, les préférences, la
qualité minimale, les règles de sécurité.

Concrètement, le seul point d'entrée envisageable est **après** `candidats()`
de `maintenant.js` — la fonction qui applique toutes ces portes. Un candidat
sponsorisé qui n'y figure pas n'existe pas. Un test le garde dès aujourd'hui
(`tests/maintenant-coeur-autour.test.mjs`, « la sélection est aveugle à toute
donnée commerciale ») : `selection()` rend exactement le même résultat quand on
lui passe `sponsor`, `campaign_id`, `enchere` ou `current_price`, et le code du
moteur ne contient aucun de ces mots.

## La rareté

Trois places, jamais davantage — sponsorisées ou non. À maturité :

- au plus **une** place sur trois pourra être sponsorisée, et seulement si le
  candidat est dans le bassin pertinent ;
- elle sera **étiquetée** « Sponsorisé », visiblement, dans la carte elle-même ;
- jamais de « Voir tout » sur les trois places, jamais de liste de sponsors.

Autour doit continuer de se lire « Autour a choisi quelques choses pour moi »,
pas « voici les entreprises qui ont acheté l'écran ».

## L'inventaire : un créneau, pas un écran

La valeur d'une visibilité dépend du contexte :

```
zone × envie × date × tranche horaire × demande = valeur
```

« Lille-centre · vendredi · 19–20 h · Sortir » ne vaut pas « mardi · 10–11 h ».

Ce grain existe déjà : `AutourMaintenant.creneauMesure(ctx, famille)` rend
`{zone, famille, date, jour, tranche}`. C'est lui qui indexe les mesures
locales aujourd'hui, et c'est lui qui indexera l'inventaire demain.

| notion future | où elle vivra | existe aujourd'hui ? |
|---|---|---|
| `zone_id` | `idZoneActive()` / zones territoriales | **oui** |
| `category` | familles de `maintenant.js` | **oui** |
| `date`, `time_slot` | `creneauMesure()` | **oui** |
| `impression`, `detail_open`, `route_open`, `click`, `event_action` | `AutourMaintenant.MESURES`, journal local | **oui, local seulement** |
| `relevance_score` | le rang de `candidats()` (nature, distance) | implicite |
| `demand` | agrégat serveur des mesures | non — demande un envoi consenti |
| `available_inventory` | 1 place par créneau, au plus | non |
| `base_price`, `current_price` | table serveur dédiée | non |
| `campaign_id`, `sponsor_candidate` | table serveur dédiée | non |
| `conversion` | billetterie / réservation, quand mesurables | partiellement (clics sortants comptés) |

## Ce qu'il faudra faire, dans l'ordre, le jour venu

1. **Consentement.** Aucune mesure ne quitte l'appareil aujourd'hui. Les
   envoyer demandera un choix explicite et une mise à jour de
   `confidentialite.html`.
2. **Agrégation serveur.** Une RPC du même type que
   `compter_metrique_territoriale` : un nom de mesure dans une liste gelée, un
   créneau, un entier. Jamais d'identifiant de personne.
3. **Campagnes.** Une table `campagnes_maintenant` (structure, zone, envie,
   créneaux, plafond, étiquette obligatoire), lue par l'application comme une
   liste d'identifiants **éligibles**, jamais comme une liste à afficher.
4. **Le point d'insertion.** Après `candidats()`, avant la cueillette de
   `selection()` : si un candidat pertinent appartient à une campagne active
   sur ce créneau, il peut prendre **une** des trois places, marqué
   `sponsorise:true`, et l'interface l'étiquette. Le test d'étanchéité devra
   évoluer pour dire exactement cela — et continuer d'interdire tout le reste.

## Ce qu'on ne mesure pas

Le temps passé dans l'application n'est pas un objectif. Les métriques utiles
sont celles qui disent qu'une proposition a servi : fiche ouverte, favori,
itinéraire, billetterie, réservation, retour ultérieur dans Autour.

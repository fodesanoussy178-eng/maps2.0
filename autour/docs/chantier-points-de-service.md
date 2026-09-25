# Chantier séparé — l'organisation juridique n'est pas le point de service

*Noté le 25/09/2026, après la validation de la production. À traiter APRÈS,
avec une preuve propre par point de service.*

## Ce que la mesure a montré

En complétant la preuve des antennes Restos du Cœur de Tourcoing par les
sources officielles, le modèle de données a buté sur une confusion qui n'est
pas un bug de code mais un manque de concept.

Le registre officiel des entreprises (`recherche-entreprises.api.gouv.fr`)
déclare, pour l'association **LES RESTAURANTS DU COEUR** (SIREN 339863417) :

| établissement | adresse | état |
|---|---|---|
| SIRET 33986341700053 | 204 rue des Cinq Voies, 59200 Tourcoing | ouvert |
| SIRET 33986341700335 | 247 rue de la Blanche Porte, 59200 Tourcoing | fermé |

Deux établissements, dont un ouvert. Or la commune compte **cinq centres
d'activité** réellement fréquentés — Europe, Orions / Pont-Rompu, Virolois /
Bonne Nouvelle, Épidème, Bourgogne — dont les adresses sont **confirmées par la
Base Adresse Nationale** :

| centre | adresse confirmée | score BAN |
|---|---|---|
| Europe / Orions | 8 Rue de l'Europe 59200 Tourcoing | 0,965 |
| Épidème | 2 Rue de Seclin 59200 Tourcoing | 0,969 |
| Virolois / Bonne Nouvelle | Rue Bonne Nouvelle 59200 Tourcoing | 0,975 |
| Bourgogne | avenue Roger Salengro 59200 Tourcoing | 0,813 |

Ces cinq lieux existent, ils distribuent, et **aucun n'est un établissement au
sens de l'INSEE**. Ils sont exploités depuis la même personne morale, souvent
dans des locaux prêtés — une salle paroissiale, une maison des services, un
centre social. C'est le cas général du secteur social, pas une exception
tourquennoise : une association, un SIRET, plusieurs points de distribution.

## Pourquoi le modèle actuel les laisse en `candidate`

`local_discovery_publier` exige aujourd'hui un SIRET **à l'adresse du candidat**
pour considérer l'identité locale comme attestée. C'est la règle juste tant
qu'on ne sait modéliser qu'une seule chose ; elle est volontairement stricte,
et elle a évité de publier cinq fiches dont Autour ne pouvait pas prouver
l'existence. Mais elle rend structurellement impubliable le point de service
d'un réseau — c'est-à-dire précisément ce qu'une personne qui a faim cherche.

Les antennes portent donc `missing_evidence = {antenne_absente_du_registre}` et
restent visibles pour la découverte suivante, avec `coverage = incomplete` et
`shouldDiscover = true`.

## Ce que le chantier doit trancher

1. **Deux niveaux, pas un.** Une *organisation* (personne morale : SIREN, SIRET,
   objet déclaré) et un *point de service* (lieu, horaires, service rendu,
   public admis). Aujourd'hui `places` et `local_discovery_candidates` mélangent
   les deux.
2. **Quelle preuve pour un point de service ?** Un SIRET ne s'applique pas. Les
   pistes mesurées :
   - le **rattachement déclaré** — une page officielle du réseau, ou une page
     municipale, qui nomme le point ET son adresse. Mesuré : les pages de
     `restosducoeur.org` et du site départemental répondent 200 mais sont
     rendues par JavaScript, donc illisibles pour un lecteur serveur ;
   - **Soliguide**, l'annuaire avec lequel les Restos du Cœur ont conventionné.
     Son API répond `403 FORBIDDEN_API_USER` : elle demande une clé, donc une
     démarche de partenariat. C'est probablement la source la plus propre ;
   - **data·inclusion / DORA**, référentiel public de l'offre d'insertion. Son
     extrait national du 31/08/2026 ne porte pas ces antennes ; l'API demande un
     jeton (`DORA_API_TOKEN`).
3. **Ce qui ne doit pas bouger.** Deux points de service d'un même réseau ne se
   fusionnent jamais sur un téléphone, un domaine ou un réseau partagés :
   l'identité locale tient au nom du point, à l'adresse confirmée, aux
   coordonnées de la BAN et à l'identifiant de la source locale. La règle est en
   place (`samePlace`, `local_discovery_publier` clé sur la structure) et les
   tests la gardent.
4. **Et le point fermé ?** `etablissement_ferme_au_registre` existe déjà. Un
   point de service fermé doit pouvoir se dire sans effacer l'organisation.

## Ce qu'il ne faut PAS faire en attendant

Publier les cinq antennes sur la foi du nom du réseau. Une fiche qui envoie
quelqu'un devant une porte close, un jour où il n'a rien à manger, coûte plus
qu'un écran incomplet — et personne ne la signalera.

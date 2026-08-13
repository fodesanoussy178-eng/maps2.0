# Restreindre la clé Google Maps et Places

## Ce qui est exposé, et pourquoi

La clé navigateur est fournie au SDK Google Maps et au provider
`providers/googlePlaces.js`. Elle part dans les requêtes Places et l'URL des
photos. **Ce n'est pas un secret serveur** : c'est le navigateur qui appelle
Google. La cacher
dans une variable, l'encoder, la découper en morceaux ne protège de rien — elle
reste lisible dans l'onglet Réseau en trois secondes.

La seule protection qui fonctionne est côté Google : **une clé restreinte ne
sert à rien à qui la copie**, parce que Google refuse les appels qui ne viennent
pas de votre domaine.

## Ce que vous devez configurer (action manuelle, 3 minutes)

Console Google Cloud → **API et services → Identifiants** → la clé navigateur
restreinte d’Autour.

### 1 · Restriction d'application → Sites web (référents HTTP)

Ajoutez exactement ces quatre référents :

```
https://autour.eu/*
https://www.autour.eu/*
https://autour.vercel.app/*
https://*.vercel.app/*
```

Les deux premiers couvrent le domaine de production, avec et sans `www`. Le
dernier couvre les URL de prévisualisation que Vercel génère à chaque
déploiement (`autour-abc123-votrecompte.vercel.app`). Sans lui, les
préproductions cassent.

⚠️ Ne mettez **pas** `http://localhost/*` en production. Pour développer en
local, utilisez une seconde clé, restreinte à localhost et sans facturation.

### 2 · Restriction d'API

Cochez uniquement les API réellement utilisées par la clé navigateur :

- **Places API (New)**
- **Maps JavaScript API**

Décochez tout le reste. Le fond devient Google Maps avant que le provider Places
ne fournisse les fiches ; les tuiles CARTO/OSM ne sont qu'un repli indépendant
si le SDK Google est indisponible.

### 3 · Plafond de quota

**API et services → Places API (New) → Quotas.** Posez un plafond journalier
correspondant à votre usage réel, avec de la marge — par exemple 2 000
requêtes/jour pour commencer. C'est le filet de sécurité : même si la
restriction de référent était contournée, la facture reste bornée.

### 4 · Alerte de facturation

**Facturation → Budgets et alertes.** Un budget mensuel avec une alerte à 50 %
et 100 %. C'est ce qui vous prévient le jour où quelque chose part de travers.

## Ce que le code fait déjà pour limiter la dépense

- Les données Places ne sont demandées que lorsque Google Maps est réellement
  chargé ; les appels sont isolés dans `providers/googlePlaces.js` ;
- Les résumés ne sont demandés que pour une fiche hors Aide. Les conditions,
  publics et coûts d'une aide viennent des sources sociales, jamais de Google ;
- l'enrichissement prix/horaires ne concerne que **cinq candidats maximum**, et
  seulement si la requête a parlé de budget ou d'horaire ;
- les contenus Places restent en mémoire : aucun résultat, photo, horaire ou
  descriptif Places n'est écrit dans les caches locaux, Supabase ou un fichier
  de zone Autour ;
- la passe restauration ne part que lorsque « Manger » est ouvert, et une seule
  fois par zone.

## Et si vous préférez ne rien exposer

Il faudrait passer les appels par une fonction serverless qui garde la clé côté
serveur. C'est la bonne solution à terme, elle est décrite dans
`docs/sortie-overpass.md` (même mécanique : une fonction Edge qui met en cache).
Tant que ce n'est pas fait, une clé restreinte par référent + quota plafonné est
une protection réelle, et c'est la pratique courante pour ce type
d'application.

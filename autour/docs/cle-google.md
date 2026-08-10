# Restreindre la clé Google Places

## Ce qui est exposé, et pourquoi

La clé est dans `index.html` et part dans chaque requête (`X-Goog-Api-Key`) ainsi
que dans l'URL des photos (`…/media?key=…`). **C'est inévitable pour une
application sans serveur** : c'est le navigateur qui appelle Google. La cacher
dans une variable, l'encoder, la découper en morceaux ne protège de rien — elle
reste lisible dans l'onglet Réseau en trois secondes.

La seule protection qui fonctionne est côté Google : **une clé restreinte ne
sert à rien à qui la copie**, parce que Google refuse les appels qui ne viennent
pas de votre domaine.

## Ce que vous devez configurer (action manuelle, 3 minutes)

Console Google Cloud → **API et services → Identifiants** → la clé
`AIzaSyAFjDL4NtNNaTFhD-tbN4escj8xQ9Mpio4`.

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

Cochez **uniquement** :

- **Places API (New)**

Décochez tout le reste. Aujourd'hui l'application n'appelle que
`places:searchNearby`, `places:searchText`, `places/{id}` et l'endpoint photo.
Une clé qui n'ouvre que ça ne peut pas servir à consommer Directions, Geocoding
ou Maps JavaScript sur votre compte.

### 3 · Plafond de quota

**API et services → Places API (New) → Quotas.** Posez un plafond journalier
correspondant à votre usage réel, avec de la marge — par exemple 2 000
requêtes/jour pour commencer. C'est le filet de sécurité : même si la
restriction de référent était contournée, la facture reste bornée.

### 4 · Alerte de facturation

**Facturation → Budgets et alertes.** Un budget mensuel avec une alerte à 50 %
et 100 %. C'est ce qui vous prévient le jour où quelque chose part de travers.

## Ce que le code fait déjà pour limiter la dépense

- Les résumés (`generativeSummary`, `editorialSummary`) ne sont demandés que
  lorsqu'une fiche d'aide s'ouvre, jamais pour une zone entière ;
- l'enrichissement prix/horaires ne concerne que **cinq candidats maximum**, et
  seulement si la requête a parlé de budget ou d'horaire ;
- chaque lieu n'est demandé qu'une fois, et la réponse est conservée ;
- une erreur 4xx est mémorisée pour ne pas relancer la même requête ;
- la passe restauration ne part que lorsque « Manger » est ouvert, et une seule
  fois par zone.

## Et si vous préférez ne rien exposer

Il faudrait passer les appels par une fonction serverless qui garde la clé côté
serveur. C'est la bonne solution à terme, elle est décrite dans
`docs/sortie-overpass.md` (même mécanique : une fonction Edge qui met en cache).
Tant que ce n'est pas fait, une clé restreinte par référent + quota plafonné est
une protection réelle, et c'est la pratique courante pour ce type
d'application.

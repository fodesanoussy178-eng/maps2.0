# Recette de l'intégration ChatGPT — les dix cas

> Exécuté le 25/09/2026 à 16 h 30 (Paris), par la vraie route `/api/mcp`,
> avec les lignes réelles relevées en base le même jour
> (`tests/fixtures-mcp.mjs`). Le seul maillon remplacé est le transport
> vers Supabase : le proxy de l'environnement de développement refuse
> `*.supabase.co`. L'exécution contre la base en production reste à faire,
> après déploiement — elle est notée comme telle dans le rapport.

Pour chaque cas : la question, l'outil choisi, les paramètres, ce qu'Autour
a rendu, et le texte exact transmis au modèle — c'est lui qui porte la
réponse, liens compris.

---

## « Que faire à Lille ce soir ? »

| | |
|---|---|
| Outil | `search_now` |
| Paramètres | `{"location":"Lille","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 3 · état `ready` |

| Résultat | Type / service | Quand | Distance | Fiabilité |
|---|---|---|---|---|
| Un pied, cent toises - par Marin Martinie | Exposition | Vendredi 25 septembre · 14h30–18h30 | 582 m | verified |
| Foire aux manèges de Lille | Festival | Vendredi 25 septembre · 16h00–23h59 | 1057 m | verified |
| Enfances, enfances ? Une exposition de Souleymane Balde | Exposition | Vendredi 25 septembre · 14h00–18h00 | 1402 m | verified |

**Texte transmis au modèle :**

```
- Un pied, cent toises - par Marin Martinie · Exposition · Vendredi 25 septembre · 14h30–18h30 · Centre d'Arts Plastiques et Visuels · Entrée libre · 582 m
  Voir la fiche dans Autour : https://autour.eu/event/0c746b6d-7e8e-4c50-bb75-f9f1f4ea19a6/un-pied-cent-toises-par-marin-martinie?utm_source=chatgpt&utm_medium=app&utm_campaign=search_now&utm_content=event
- Foire aux manèges de Lille · Festival · Vendredi 25 septembre · 16h00–23h59 · Champ de Mars Lille, 59013, Lille · 1,1 km
  Voir la fiche dans Autour : https://autour.eu/event/b3ad2b80-2f74-49cf-97e3-dd7a35c4ee84/foire-aux-maneges-de-lille?utm_source=chatgpt&utm_medium=app&utm_campaign=search_now&utm_content=festival
- Enfances, enfances ? Une exposition de Souleymane Balde · Exposition · Vendredi 25 septembre · 14h00–18h00 · Médiathèque Vieux-Lille · Entrée libre · 1,4 km
  Voir la fiche dans Autour : https://autour.eu/event/fa675588-fc15-4767-842f-f0bffdc0ad67/enfances-enfances-une-exposition-de-souleymane-balde?utm_source=chatgpt&utm_medium=app&utm_campaign=search_now&utm_content=event
Voir tous les résultats dans Autour : https://autour.eu/explorer?ville=Lille&lat=50.62920&lng=3.05730&utm_source=chatgpt&utm_medium=app&utm_campaign=search_now
```

**Bouton :** Voir tous les résultats dans Autour → <https://autour.eu/explorer?ville=Lille&lat=50.62920&lng=3.05730&utm_source=chatgpt&utm_medium=app&utm_campaign=search_now>

---

## « Une brocante à Tourcoing dimanche ? »

| | |
|---|---|
| Outil | `search_events` |
| Paramètres | `{"location":"Tourcoing","query":"brocante","when":"dimanche","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 0 |

**Ce qu'Autour dit en plus :**

- Aucun événement de l'inventaire Autour ne correspond à cette demande pour « dimanche ».

**Texte transmis au modèle :**

```
Aucun événement de l'inventaire Autour ne correspond à cette demande pour « dimanche ».
Voir tous les résultats dans Autour : https://autour.eu/explorer?q=brocante+Tourcoing&ville=Tourcoing&quand=dimanche&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=brocante
```

**Bouton :** Voir tous les résultats dans Autour → <https://autour.eu/explorer?q=brocante+Tourcoing&ville=Tourcoing&quand=dimanche&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=brocante>

---

## « — et samedi ? »

| | |
|---|---|
| Outil | `search_events` |
| Paramètres | `{"location":"Tourcoing","query":"brocante","when":"samedi","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 1 |

| Résultat | Type / service | Quand | Distance | Fiabilité |
|---|---|---|---|---|
| Grande Braderie d'Automne à Tissel | Braderie | Samedi 26 septembre · 10h00–17h00 | 3077 m | verified |

**Texte transmis au modèle :**

```
- Grande Braderie d'Automne à Tissel · Braderie · Samedi 26 septembre · 10h00–17h00 · TISSEL · Entrée libre · 3,1 km
  Voir la fiche dans Autour : https://autour.eu/event/3957e0d9-da67-4376-a9d2-0ebf1f7bbff3/grande-braderie-d-automne-a-tissel?utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=braderie
Voir tous les résultats dans Autour : https://autour.eu/explorer?q=brocante+Tourcoing&ville=Tourcoing&quand=samedi&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=brocante
```

**Bouton :** Voir tous les résultats dans Autour → <https://autour.eu/explorer?q=brocante+Tourcoing&ville=Tourcoing&quand=samedi&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=brocante>

---

## « Quels concerts rap cette semaine ? »

| | |
|---|---|
| Outil | `search_events` |
| Paramètres | `{"location":"Lille","query":"concert rap","when":"cette semaine","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 0 |

**Ce qu'Autour dit en plus :**

- Aucun événement de l'inventaire Autour ne correspond à cette demande pour « cette semaine ».

**Texte transmis au modèle :**

```
Aucun événement de l'inventaire Autour ne correspond à cette demande pour « cette semaine ».
Voir tous les résultats dans Autour : https://autour.eu/explorer?q=concert+rap+Lille&ville=Lille&quand=cette+semaine&lat=50.62920&lng=3.05730&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=rap
```

**Bouton :** Voir tous les résultats dans Autour → <https://autour.eu/explorer?q=concert+rap+Lille&ville=Lille&quand=cette+semaine&lat=50.62920&lng=3.05730&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=rap>

---

## « Où manger gratuitement à Tourcoing aujourd'hui ? »

| | |
|---|---|
| Outil | `search_help` |
| Paramètres | `{"location":"Tourcoing","need":"food","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 2 · couverture `incomplete` |

| Résultat | Type / service | Quand | Distance | Fiabilité |
|---|---|---|---|---|
| Croix-Rouge française - Unité Locale de Tourcoing | food, food_bank, grocery | — | 1399 m | verified |
| CCAS de Tourcoing | administrative_assistance, food, meals | — | 74 m | verified |

**Ce qu'Autour dit en plus :**

- 3 point(s) de service trouvé(s) mais NON vérifié(s) ne sont pas rendus : Autour ne les présente pas comme certains.
- Autour sait que sa couverture est incomplète pour ce besoin ici : d'autres points de service existent probablement et ne sont pas encore vérifiés.

**Texte transmis au modèle :**

```
- Croix-Rouge française - Unité Locale de Tourcoing · food/food_bank/grocery · 2 Rue de la Vigne 59200 Tourcoing · tél. 03 20 46 39 00 · 1,4 km
  Voir les aides autour de moi dans Autour : https://autour.eu/place/3391a002-ceda-4706-b85b-f98ecd635986/croix-rouge-francaise-unite-locale-de-tourcoing?lat=50.71975&lng=3.14190&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=manger
- CCAS de Tourcoing · administrative_assistance/food/meals · 26 Rue de la Bienveillance · tél. 03 20 11 34 34 · 74 m
  Voir les aides autour de moi dans Autour : https://autour.eu/place/9072d1c4-f65c-42d8-bdf8-93e650498647/ccas-de-tourcoing?lat=50.72310&lng=3.16040&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=manger
3 point(s) de service trouvé(s) mais NON vérifié(s) ne sont pas rendus : Autour ne les présente pas comme certains.
Autour sait que sa couverture est incomplète pour ce besoin ici : d'autres points de service existent probablement et ne sont pas encore vérifiés.
Couverture Autour : incomplete.
Voir les aides autour de moi dans Autour : https://autour.eu/solidarite?besoin=manger&ville=Tourcoing&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=manger
```

**Bouton :** Voir les aides autour de moi dans Autour → <https://autour.eu/solidarite?besoin=manger&ville=Tourcoing&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=manger>

---

## « Je cherche un foyer ou un hébergement »

| | |
|---|---|
| Outil | `search_help` |
| Paramètres | `{"location":"Tourcoing","need":"je cherche un foyer ou un hébergement","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 2 · couverture `incomplete` |

| Résultat | Type / service | Quand | Distance | Fiabilité |
|---|---|---|---|---|
| Communauté Emmaüs de Tourcoing | housing, shelter, clothing | — | 1062 m | verified |
| CCAS de Tourcoing | administrative_assistance, food, meals | — | 74 m | verified |

**Ce qu'Autour dit en plus :**

- Autour sait que sa couverture est incomplète pour ce besoin ici : d'autres points de service existent probablement et ne sont pas encore vérifiés.

**Texte transmis au modèle :**

```
- Communauté Emmaüs de Tourcoing · housing/shelter/clothing · 172 Rue Winoc Chocqueel 59200 Tourcoing · tél. 03 20 70 90 00 · 1,1 km
  Voir les aides autour de moi dans Autour : https://autour.eu/place/48ad1cae-a0fa-4cb7-b8b4-3f4b67fe3916/communaute-emmaus-de-tourcoing?lat=50.71966&lng=3.17440&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=logement
- CCAS de Tourcoing · administrative_assistance/food/meals · 26 Rue de la Bienveillance · tél. 03 20 11 34 34 · 74 m
  Voir les aides autour de moi dans Autour : https://autour.eu/place/9072d1c4-f65c-42d8-bdf8-93e650498647/ccas-de-tourcoing?lat=50.72310&lng=3.16040&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=logement
Autour sait que sa couverture est incomplète pour ce besoin ici : d'autres points de service existent probablement et ne sont pas encore vérifiés.
Couverture Autour : incomplete.
Voir les aides autour de moi dans Autour : https://autour.eu/solidarite?besoin=logement&ville=Tourcoing&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=logement
```

**Bouton :** Voir les aides autour de moi dans Autour → <https://autour.eu/solidarite?besoin=logement&ville=Tourcoing&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_help&utm_content=logement>

---

## « Que faire en famille ce week-end ? »

| | |
|---|---|
| Outil | `search_events` |
| Paramètres | `{"location":"Tourcoing","query":"activité famille","when":"ce week-end","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 1 |

| Résultat | Type / service | Quand | Distance | Fiabilité |
|---|---|---|---|---|
| Grande Braderie d'Automne à Tissel | Braderie | Samedi 26 septembre · 10h00–17h00 | 3077 m | verified |

**Texte transmis au modèle :**

```
- Grande Braderie d'Automne à Tissel · Braderie · Samedi 26 septembre · 10h00–17h00 · TISSEL · Entrée libre · 3,1 km
  Voir la fiche dans Autour : https://autour.eu/event/3957e0d9-da67-4376-a9d2-0ebf1f7bbff3/grande-braderie-d-automne-a-tissel?utm_source=chatgpt&utm_medium=app&utm_campaign=search_events&utm_content=braderie
Voir tous les résultats dans Autour : https://autour.eu/explorer?q=activit%C3%A9+famille+Tourcoing&ville=Tourcoing&quand=ce+week-end&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events
```

**Bouton :** Voir tous les résultats dans Autour → <https://autour.eu/explorer?q=activit%C3%A9+famille+Tourcoing&ville=Tourcoing&quand=ce+week-end&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_events>

---

## « Y a-t-il un marché près de moi ? »

| | |
|---|---|
| Outil | `search_nearby` |
| Paramètres | `{"lat":50.72373,"lng":3.160758,"query":"marché","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 0 |

**Ce qu'Autour dit en plus :**

- Aucun lieu de l'inventaire Autour ne correspond à cette demande dans ce rayon.

**Texte transmis au modèle :**

```
Aucun lieu de l'inventaire Autour ne correspond à cette demande dans ce rayon.
Voir tous les résultats dans Autour : https://autour.eu/explorer?q=march%C3%A9&ville=M%C3%A9tropole+lilloise&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_nearby&utm_content=marche
```

**Bouton :** Voir tous les résultats dans Autour → <https://autour.eu/explorer?q=march%C3%A9&ville=M%C3%A9tropole+lilloise&lat=50.72373&lng=3.16076&utm_source=chatgpt&utm_medium=app&utm_campaign=search_nearby&utm_content=marche>

---

## « Que faire à Bordeaux ce soir ? »

| | |
|---|---|
| Outil | `search_now` |
| Paramètres | `{"location":"Bordeaux","lat":44.8378,"lng":-0.5792,"time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 0 · état `horsZone` |

**Ce qu'Autour dit en plus :**

- Autour ne couvre pas encore Bordeaux. Zones couvertes : Métropole lilloise, Paris, Angers, Rennes, Rouen.

**Texte transmis au modèle :**

```
Autour ne couvre pas encore Bordeaux. Zones couvertes : Métropole lilloise, Paris, Angers, Rennes, Rouen.
```


---

## « Ouvre-moi la fiche de la braderie »

| | |
|---|---|
| Outil | `get_event` |
| Paramètres | `{"id":"3957e0d9-da67-4376-a9d2-0ebf1f7bbff3","time":"2026-09-25T14:30:00Z"}` |
| HTTP | 200 |
| Résultats | 1 |

| Résultat | Type / service | Quand | Distance | Fiabilité |
|---|---|---|---|---|
| Grande Braderie d'Automne à Tissel | Braderie | Samedi 26 septembre · 10h00–17h00 (2 séances) | 0 m | verified |

**Texte transmis au modèle :**

```
- Grande Braderie d'Automne à Tissel · Braderie · Samedi 26 septembre · 10h00–17h00 · séances : 08:00, 12:00 · TISSEL · Entrée libre · 0 m
  Voir la fiche dans Autour : https://autour.eu/event/3957e0d9-da67-4376-a9d2-0ebf1f7bbff3/grande-braderie-d-automne-a-tissel?utm_source=chatgpt&utm_medium=app&utm_campaign=get_event&utm_content=braderie
```


# Autour dans ChatGPT — dossier de préparation

> État au 25/09/2026. **Rien n'a été soumis à OpenAI.** Ce document rassemble
> ce qu'une soumission demande, ce qui est prêt, et ce qui ne l'est pas encore.

---

## 1. Ce que l'app fait, et ce qu'elle ne fait pas

ChatGPT pose une question locale ; Autour répond avec ce qu'il a déjà collecté
et vérifié ; l'utilisateur peut ouvrir la vue correspondante sur autour.eu.

Le partage des rôles est explicite, et il est tenu par le code :

| Dans ChatGPT | Dans Autour |
|---|---|
| trois résultats au maximum | tous les résultats |
| nom, type, date, distance, résumé, image | la carte, les marqueurs, le décor |
| un bouton vers la bonne vue | l'itinéraire, les favoris, les filtres, la personnalisation, la publication |
| l'état de fiabilité et de couverture | l'exploration complète, la zone, le contexte territorial |

Le texte rendu à ChatGPT porte **déjà** ce qu'il faut pour répondre : nom, date,
lieu, distance, prix, et l'avertissement de fiabilité s'il y en a un. Rien n'est
retenu pour provoquer un clic.

---

## 2. Identité de l'app

| Champ | Valeur |
|---|---|
| Nom | **Autour** |
| Description courte | Découvre ce qui se passe autour de toi : événements, lieux, bons plans et aides locales. |
| Catégorie | Vie locale / découverte |
| Langue principale | Français |
| Icône | `data/app-chatgpt/autour-icone.svg` et `autour-icone-512.png` (512 × 512) |
| Site | https://autour.eu |
| Confidentialité | https://autour.eu/confidentialite (section « Quand tu interroges Autour depuis ChatGPT ») |
| Mentions légales | https://autour.eu/mentions-legales |
| Domaines | `autour.eu` (application et serveur MCP) |
| Contact | celui des mentions légales |

### Description complète

> Autour rassemble ce qui se passe près de chez soi : les événements datés des
> agendas publics, les lieux de l'inventaire local — parcs, bibliothèques,
> cinémas, marchés, patrimoine, équipements sportifs — et les points de service
> d'aide locale : aide alimentaire, hébergement, santé, démarches, vêtements,
> hygiène, emploi, écoute.
>
> Les données sont collectées et vérifiées en amont par les agents d'Autour, pas
> au moment de la question : une réponse est donc rapide, et elle porte sa
> fiabilité. Un résultat vérifié le dit ; un résultat encore incertain n'est pas
> présenté comme un fait ; et quand Autour sait que sa couverture est incomplète
> sur un besoin, il le dit plutôt que de compléter par autre chose.
>
> Pour l'aide locale, Autour répond par un **point de service** — un endroit où
> l'on est reçu, avec son adresse, son service, ses horaires et sa distance —
> jamais par la seule organisation juridique. Une même association peut tenir
> plusieurs points de distribution : ce sont plusieurs réponses, jamais une
> seule.
>
> Territoires couverts aujourd'hui : Métropole lilloise, Paris, Angers, Rennes,
> Rouen.

---

## 3. Le serveur MCP

| | |
|---|---|
| Endpoint | `https://autour.eu/api/mcp` — **en ligne depuis le 25/09/2026** |
| Transport | HTTP JSON-RPC (POST). `GET` rend une fiche de service, sans donnée. |
| Version de protocole | `2025-06-18` |
| Écriture | **aucune** — six outils, tous en lecture (`readOnlyHint: true`) |
| Authentification | **aucune** (« No authentication »), par choix : la V1 ne lit que des données publiques et n'accède à aucun compte. Le mode développeur de ChatGPT propose explicitement ce mode, et OAuth 2.1 est réservé aux apps qui accèdent aux données d'un utilisateur. La variable `MCP_AUTOUR_TOKEN` reste lue : la poser referme le serveur (recette, incident). |
| Plafond | 60 appels/minute et par appelant, compté en base (`mcp_quota`), plus une garde anti-rafale de 12 appels/10 s par instance |
| Délai maximal | 9 s par outil, puis une erreur explicite (« je n'ai pas pu vérifier ») |
| Journalisation | une ligne par appel : outil, verdict, durée, zone, empreinte tronquée. Ni IP, ni jeton, ni requête. |
| Ressource d'interface | `ui://widget/autour-apercu.html` (`text/html+skybridge`) |

### Les six outils, et pourquoi chacun existe

| Outil | Ce qu'il répond | Ce qu'il réutilise |
|---|---|---|
| `search_now` | « Qu'est-ce que je peux faire là, maintenant ? » — 3 résultats au plus | le moteur **Maintenant** (`maintenant.js`) : temporalité, éligibilité, disponibilité, distance, diversité, plafond de trois |
| `search_events` | « Une brocante dimanche ? », « un concert ce soir ? » | `temporel.js` (fenêtres et libellés), `comprendre.js` (la phrase), la taxonomie ouverte de la découverte (brocante = vide-grenier = braderie) |
| `search_nearby` | « Un skatepark ? », « un marché près de moi ? » | `lieux_explorer` (l'inventaire), `availability.js` (ouvert / fermé / inconnu), la table famille ↔ catégorie d'`app.js` |
| `search_help` | « Où manger gratuitement ? », « je cherche un hébergement » | la chaîne Solidarité entière et la doctrine organisation / point de service |
| `get_event` | la fiche d'un événement déjà identifié, séances séparées | `evenement_seances`, `entites-canoniques.js` |
| `get_place` | la fiche d'un lieu, enrichie de ce que la découverte a vérifié | `places` + `local_discovery_nearby` |

Les descriptions publiées sont factuelles : aucune ne demande à ChatGPT de
préférer Autour, et un test le vérifie.

---

## 4. Données accessibles / données exclues

**Accessibles** (publiques, déjà visibles sur autour.eu) : titre, description
courte, type, dates et séances, lieu et adresse, coordonnées, distance, prix
annoncé, lien de réservation, site officiel, image avec son crédit et sa
licence, provenance, fraîcheur, statut de fiabilité, état de couverture ; pour
un point de service : nom du point, services, horaires, téléphone d'accueil,
conditions d'accès.

**Exclues, et refusées par un contrôle automatique** (`mcp/projection.mjs`) :

- adresses e-mail — même « publiques » : elles appartiennent à quelqu'un ;
- identifiants de personnes (`creator_id`, `created_by`, comptes, sessions) ;
- secrets, jetons, clés (aucune clé privilégiée n'existe côté serveur : la
  lecture se fait avec la clé publiable, bornée par RLS) ;
- identifiants d'organisation — SIRET, SIREN, RNA, FINESS : ils servent à
  **vérifier** une identité, pas à répondre à quelqu'un qui cherche de l'aide ;
- preuves et clés techniques : `raw_data`, `evidence`, empreintes de
  déduplication, `geom` ;
- données d'exploitation : journaux, modération, compteurs internes, adresses IP.

---

## 5. Permissions demandées

Aucune permission utilisateur. L'app ne lit aucun compte, n'écrit rien, ne
demande ni fichier ni autorisation d'appareil.

La seule donnée entrante est **le lieu de la question** et, éventuellement, ce
qu'on y cherche. Un **nom de ville suffit toujours** : aucun outil n'exige de
coordonnées, et aucun ne demande une position GPS précise. Quand des
coordonnées sont fournies malgré tout, elles sont **arrondies au millième de
degré — une centaine de mètres** — dès l'entrée, avant tout usage, tout renvoi
et toute journalisation. La description de chaque champ le dit à ChatGPT, pour
qu'il ne réclame pas mieux.

---

## 6. Exemples de prompts

- « Que faire à Lille ce soir ? »
- « Une brocante à Tourcoing dimanche ? »
- « Quels concerts rap cette semaine à Lille ? »
- « Où manger gratuitement à Tourcoing aujourd'hui ? »
- « Je cherche un foyer ou un hébergement d'urgence à Tourcoing »
- « Que faire en famille ce week-end à Rennes ? »
- « Y a-t-il un marché près de la place de la République à Tourcoing ? »
- « Ouvre-moi la fiche de cet événement » (après un premier résultat)

---

## 7. Scénarios de revue

1. **Découverte** — « Que faire à Lille ce soir ? » → `search_now` → au plus
   trois propositions en cours, chacune avec sa date, sa distance et son lien.
2. **Recherche datée** — « Une brocante à Tourcoing dimanche ? » → `search_events`
   → si rien n'a lieu dimanche, la réponse le dit et propose la recherche
   complète ; elle n'invente pas un événement.
3. **Aide locale** — « Où manger gratuitement à Tourcoing ? » → `search_help` →
   des points de service vérifiés (nom du point, adresse, service, horaires,
   téléphone), la mention que la couverture est incomplète, et le lien vers
   Solidarité.
4. **Fiabilité** — demander une ville non couverte (« Bordeaux ») → la réponse
   dit qu'Autour ne couvre pas encore cet endroit, sans résultat de
   remplacement.
5. **Fiche** — `get_event` sur un identifiant rendu plus tôt → séances séparées,
   prix, réservation, provenance.

---

## 8. Instructions de test (mode développeur ChatGPT)

1. Paramètres → Connecteurs → Mode développeur → **Créer**.
2. URL du serveur : `https://autour.eu/api/mcp`.
3. Authentification : **Aucune**. (Si `MCP_AUTOUR_TOKEN` est posé côté serveur,
   les appels sont refusés avec `401 authentification requise` — c'est le
   levier de fermeture, pas le mode nominal.)
4. Vérifier que six outils apparaissent, tous en lecture seule.
5. Dérouler les sept prompts de la section 6.

Pour une vérification hors ChatGPT :

```bash
curl -s https://autour.eu/api/mcp                        # fiche de service
curl -s -X POST https://autour.eu/api/mcp \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <jeton>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 8 bis. Recette de production du 25/09/2026

Les dix scénarios ont été rejoués contre le serveur **déployé**, depuis
Postgres (pg_net), sur les vraies données. Résultat : dix réponses `200`, et
**quatre défauts que les lignes de test ne montraient pas**.

| Ce que la production a rendu | Diagnostic | Correction |
|---|---|---|
| « Quels concerts rap ? » → *expérience en réalité virtuelle* | `includes("rap")` trouve « rap » dans **g·rap·hique**, **thé·rap·ie**, **·rap·ide** | on compare des mots, préfixe admis à partir de 5 lettres |
| « Que faire ce soir ? » → *Halles de Wazemmes · **Jeudi 1 janvier*** | période longue sans horaires → statut inconnu → le libellé récitait la borne de début | « En cours », le mot que l'application affiche déjà |
| « Je cherche un hébergement » → *RELAIS SOLEIL · **Travail / argent*** | services listés dans l'ordre de la source | le service qui répond à la question passe devant |
| *séances : 08:00, 09:00, **08:00, 09:00*** | trois jours rendus comme des heures nues | dédoublonnées et datées |

Quatre tests de régression citent ces sorties. Les routes profondes ont été
vérifiées dans un navigateur (`outils/sonde-liens.mjs`) : `/solidarite?besoin=manger`
ouvre bien la feuille sur « 🍴 Manger ». `/explorer` a révélé un cinquième
défaut — la recherche regéocodait la ville déjà placée et n'appliquait jamais
l'intention — corrigé également.

Les six routes profondes répondent `200` en production, y compris les deux
formes titrées qui rendaient `404` avant ce chantier.

---

## 9. Ce qui reste à faire avant de soumettre

1. ~~Décider de l'ouverture du point d'entrée.~~ **Fait le 25/09/2026** :
   « No authentication » + plafond d'appels. Vérifié contre les exigences
   d'OpenAI : le mode développeur propose ce mode explicitement, OAuth 2.1
   couvre les apps qui accèdent aux données d'un utilisateur — ce n'est pas le
   cas ici —, et le moindre privilège est un critère de revue. `MCP_AUTOUR_TOKEN`
   a été retiré de l'hébergement.
2. **Revérifier le contrat Apps SDK contre la documentation officielle.** Les
   clés `_meta` employées (`openai/outputTemplate`,
   `openai/toolInvocation/invoking`, `openai/toolInvocation/invoked`,
   `openai/widgetAccessible`, `openai/resultCanProduceWidget`) et le type MIME
   `text/html+skybridge` sont ceux de l'Apps SDK ; `developers.openai.com` est
   inaccessible depuis l'environnement de développement (proxy), la
   confrontation à la documentation du jour reste donc à faire.
3. **Essayer l'app dans ChatGPT** (mode développeur) : cet essai demande un
   compte ChatGPT, il ne peut pas être fait depuis l'environnement de
   développement d'Autour. Les dix scénarios doivent y être rejoués avant toute
   soumission.
4. **Accord explicite** avant toute soumission.

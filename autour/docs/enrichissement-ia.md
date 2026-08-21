# L'enrichissement vérifié

> Le code de `supabase/functions/enrichir-lieu/index.ts` référence ce document.
> Il n'existait pas : la fonction et sa table vivaient en production sans que
> le dépôt en dise un mot. Le voici.

## Le défaut corrigé

« Maintenant » ne fait entrer que des lieux dont on **sait** qu'ils sont
ouverts. C'est une bonne règle — envoyer quelqu'un devant une porte close est
exactement ce qu'on veut éviter. Mais la plupart des lieux d'OpenStreetMap
n'ont aucun horaire, et beaucoup en ont d'anciens.

Le musée qui a changé ses horaires en septembre reste fermé le mardi dans nos
données depuis 2019. La salle qui rouvre après travaux n'existe plus pour
nous. L'exposition en cours n'apparaît nulle part, parce qu'aucun catalogue
ne la publie.

Ces choses sont écrites, en français, sur des pages officielles. C'est ce
qu'un modèle ancré sur la recherche sait aller lire — et c'est tout ce qu'on
lui demande. Il ne raconte pas le lieu : il rapporte ce qu'une page affirme,
avec l'adresse de cette page.

## L'architecture réelle

```
Autour affiche ce qu'il sait
        ↓  (l'écran est déjà utile)
recommandations posées → PERF.jalon("recommandations_posees")
        ↓  tranche d'inactivité (ORDO.differer)
enrichirCandidats()                      app.js
        ├── Google Places  (ce qui existait)
        └── calque vérifié (ce qui est branché ici)
                ↓
        5 candidats au plus, et seulement ceux à qui il manque
        quelque chose  →  AutourEnrichissements.manques()
                ↓
        lecture du cache  place_enrichments   (une requête pour la vague)
                ↓
        frais ?  ─── oui ──→  on applique, on ne dépense rien
                ↓ non
        POST /functions/v1/enrichir-lieu     (3 en vol au plus)
                ↓
        Gemini + google_search               (côté serveur uniquement)
                ↓
        extraction.mjs : classe les sources, valide, ou rend null
                ↓
        écriture place_enrichments  (y compris « rien trouvé »)
                ↓
        retour au client → applique → planifierRendu()
```

Rien de cette colonne n'est sur le chemin critique. Une panne du modèle, un
budget épuisé, un réseau coupé : dans les trois cas l'écran garde exactement
ce qu'il montrait.

## Les trois règles

**1. Une donnée sans source n'existe pas.** Le modèle peut écrire ce qu'il
veut ; si l'API n'a cité aucune page d'ancrage (`groundingChunks`), tout est
jeté. On ne garde pas « la partie plausible ». C'est vérifié par
`construireFait`, qui rend `null` avant de lire quoi que ce soit d'autre.

**2. On n'invente jamais ce qui manque.** Un horaire absent reste absent. Une
colonne nulle veut dire « on ne sait pas », et « on ne sait pas » n'est pas
« non ». Une date aberrante redevient nulle ; des horaires qui ne ressemblent
pas à une grille sont refusés.

**3. La provenance décide du pouvoir.** Seule une source qui appartient au
lieu ou à une institution peut écraser un `opening_hours` OpenStreetMap
(`peutEcraserOsm`). Un agrégateur ne l'obtient jamais — et c'est précisément
parce qu'ils l'affirment tous avec aplomb que la règle porte sur la
**provenance** et non sur la formulation.

### L'ordre des sources

| rang | type | exemple |
|---|---|---|
| 1 | `site_officiel` | le domaine du lieu |
| 2 | `agenda_officiel` | son agenda, ou celui de la commune |
| 3 | `billetterie_officielle` | sa page de réservation |
| 4 | `institutionnel` | mairie, agglomération, office de tourisme |
| 5 | `tiers` | tout le reste, en dernier recours |

Un tiers ne ferme jamais un lieu et ne réécrit jamais ses horaires. Il peut
porter une URL de billetterie — une adresse se vérifie d'un clic.

La confiance annoncée par le modèle est un **plafond**, pas une mesure : elle
est bornée par la qualité de la meilleure source réellement citée. Un modèle
très sûr de lui qui n'a lu qu'un annuaire reste un annuaire (0,5 au plus).

## La fraîcheur

Le TTL dépend de **ce qu'on a trouvé**, pas du moment où on a demandé :

| trouvé | validité |
|---|---|
| une programmation | 1 jour — ça change tous les jours |
| une grille d'horaires | 7 jours — ça bouge aux saisons |
| une fermeture | 7 jours — à revérifier, c'est un état qui finit |
| rien | 3 jours |

**Un lieu muet est mis en cache aussi.** Sans quoi les lieux sur lesquels on
ne trouve rien seraient les plus coûteux de tous, redemandés à chaque
ouverture de l'application.

Une entrée périmée reste **affichable** — elle est vraie plus souvent que
rien — mais elle déclenche une revérification et ne compte plus comme fraîche.

## L'effet sur « Maintenant »

Ordre de vérité : enrichissement officiel frais > donnée institutionnelle
récente > OpenStreetMap récent > OpenStreetMap ancien.

- `temporary_closed === true` → **exclu** (`RAISONS.FERME_VERIFIE`)
- `current_status === "closed"` ou `"permanently_closed"` → **exclu**
- `current_status === "open"` → lève l'inconnu que nos données laissaient
- `programme_now` non vide → passe de `OUVERT` à `ACTIVITE`, ce qui le fait
  remonter dans `RANG`, et lève même l'exclusion des commodités : une salle
  qui joue ce soir n'est plus une commodité
- `programme_soon` → **jamais** ici. Ce qui commence demain n'a pas lieu
  maintenant ; il appartient aux créneaux « ce soir » et « à venir ».

Les plafonds ne bougent pas : 3 visibles, 10 au total.

## Le coût

| garde-fou | valeur |
|---|---|
| candidats par vague | 5 au plus |
| vérifications en vol | 3 au plus |
| budget quotidien | `ENRICHISSEMENT_BUDGET_JOUR`, 400 par défaut |
| délai côté serveur | 15 s |
| délai côté client | 20 s |
| commodités | jamais enrichies |
| cache | consulté avant tout appel |

Le budget ne protège pas d'un abus ciblé — rien ne le fait sur une route
publique. Il garantit que le pire cas reste **borné et connu** : une journée
sans enrichissement, jamais une facture.

## Les clés

`GEMINI_API_KEY` ne quitte jamais Supabase. Elle est posée en **en-tête**
(`x-goog-api-key`), jamais dans une URL — une URL se journalise.

Le navigateur n'utilise que la clé **publiable**, celle qui est déjà dans la
page pour toutes les autres lectures Supabase et qui est publique par
construction. C'est pourquoi `enrichir-lieu` garde `verify_jwt = true` :

> Lui donner un `x-sync-secret` serait un recul. Il faudrait soit poser un
> secret privé dans la page — c'est-à-dire le publier — soit ajouter un relais
> serveur qui n'apporterait rien de plus que le JWT.

Le nom du lieu vient du client, donc d'un inconnu. Il est réduit avant
d'approcher l'invite : ni saut de ligne, ni caractère de contrôle, ni
ponctuation qui permette d'écrire une consigne. On ne se défend pas par une
liste de phrases interdites — elle serait toujours en retard d'une tournure —
mais en réduisant l'alphabet.

## Les variables d'environnement

Côté **Supabase** (secrets du projet) :

| variable | rôle |
|---|---|
| `GEMINI_API_KEY` | la clé du modèle. Absente : la fonction sert le cache et le dit, sans erreur |
| `GEMINI_MODEL` | facultatif, `gemini-2.0-flash` par défaut |
| `ENRICHISSEMENT_BUDGET_JOUR` | facultatif, 400 par défaut |
| `SUPABASE_SECRET_KEYS` ou `SUPABASE_SECRET_KEY` | l'écriture dans `place_enrichments` |
| `SUPABASE_URL` | fourni par la plateforme |

Rien côté Vercel, rien dans le navigateur.

## Ce que ça ne fait pas

- ça n'enrichit pas une zone, mais **un lieu** ;
- ça n'écrit jamais dans `publications` ni dans `events` ;
- ça ne crée aucune catégorie, aucun lieu, aucun événement ;
- ça ne devine aucun intérêt : `envies.js` reste la seule base du classement
  de « Pour toi ».

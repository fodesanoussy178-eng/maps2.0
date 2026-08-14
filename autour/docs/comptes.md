# Comptes Autour

## La règle, en une phrase

Ce qui se **consulte** est libre. Ce qui s'**approprie** demande un compte.

| Sans compte | Avec un compte |
|---|---|
| ouvrir Autour | publier |
| Explorer, la carte, les créneaux | modifier sa publication |
| voir un lieu, un événement | supprimer sa publication |
| rechercher | retrouver ses publications |
| Aide, **y compris une urgence** | mettre en favori |
| consulter une publication depuis un lien | recevoir des notifications |

Cette liste vit dans `comptes.js` (`LIBRE` / `AVEC_COMPTE`), à un seul endroit.
L'interface la lit ; elle ne la redevine pas écran par écran.

## Où est la sécurité

**Pas dans le JavaScript.** `comptes.js` décide *quand demander* et *avec quels
mots*. Il ne protège rien. Contourner ce module ne donne pas un accès : ça donne
un refus du serveur.

La protection est en base, dans `supabase/migrations/20260814124936_comptes_email.sql` :

- `created_by = auth.uid()` porte la propriété, et un déclencheur la rend immuable ;
- les policies RLS réservent `insert` / `update` / `delete` au propriétaire ;
- `private.compte_confirme()` exige en plus une adresse **confirmée** — une
  session anonyme peut lire, jamais écrire ;
- `anon` n'a aucun droit d'écriture, nulle part.

La preuve s'exécute : `supabase/tests/rls_comptes.sql` se pose lui-même en
`authenticated` avec l'uid de quelqu'un d'autre, comme le ferait un client
hostile, et vérifie 27 cas.

## L'adresse e-mail

Elle vit dans `auth.users`, qui n'est lisible ni par `anon` ni par
`authenticated`. Elle n'est copiée nulle part : `public.profiles` ne porte qu'un
pseudo facultatif et une préférence de notifications.

La migration **échoue** si une colonne d'e-mail apparaît un jour dans le schéma
public — le garde-fou est écrit à la fin du fichier plutôt que laissé à la
vigilance.

## Rattacher, ne pas recréer

Une session anonyme qui reçoit une adresse **garde son uid** (`updateUser`).
C'est ce qui rend la migration sans perte : les publications et les favoris déjà
posés restent ceux de la personne, sans qu'aucune ligne ne soit réécrite.

- session anonyme existante → `updateUser({ email })`, vérification `email_change`
- aucune session → `signInWithOtp({ email })`, vérification `email`

Se tromper de type fait échouer la vérification avec un message
incompréhensible : c'est `AutourComptes.manoeuvre(etat)` qui choisit.

## Reprendre l'action commencée

Après la connexion, Autour rejoue le geste exact qui avait déclenché la demande.
L'intention est écrite dans `sessionStorage` (`autour:action-en-attente`) parce
que **le lien reçu par e-mail fait quitter la page** : au retour, une variable
JavaScript n'aurait pas survécu. Elle se consomme une seule fois — reprendre
deux fois publierait deux fois le même événement — et expire au bout de 30
minutes.

La reprise est branchée sur `onAuthStateChange`, donc valable pour le lien
comme pour le code tapé sur place.

## Deux réglages qui ne sont pas dans le SQL

Ces deux-là se règlent dans le tableau de bord Supabase (`Authentication`), pas
par migration :

1. **Le code à six chiffres.** Le champ « code » de l'écran de compte n'est
   utilisable que si les gabarits d'e-mail (*Magic Link* et *Confirm signup* /
   *Change Email Address*) contiennent `{{ .Token }}`. Sans lui, seul le lien
   fonctionne — l'écran reste correct, mais le champ code refusera tout.

2. **Les connexions anonymes.** Autour n'en crée plus. L'option
   *Enable anonymous sign-ins* peut être désactivée ; les 195 sessions anonymes
   déjà existantes gardent leur uid et retrouveront leurs publications le jour
   où elles rattachent une adresse.

## Les bancs d'essai

```sh
node --test tests/comptes.test.mjs        # la règle, les mots, l'attente
AUTOUR_RACINE=autour node outils/comptes.mjs   # les 11 parcours, vrai navigateur
psql -f supabase/tests/rls_comptes.sql    # la propriété, en base
```

Le banc de navigateur bouchonne `auth` — un lien magique arrive par courrier,
on ne peut pas l'attendre ici. Il prouve le **produit** : ce qui est demandé,
quand, et ce qu'on retrouve après. Il ne prouve pas la sécurité, et ne le
prétend pas : c'est le rôle du script SQL.

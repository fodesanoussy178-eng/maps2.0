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

## Ce qui ne vit pas dans le SQL

Six réglages dont dépend la connexion par e-mail vivent dans la configuration
du service d'authentification, pas dans la base. Aucune migration ne les
décrit, aucun test SQL ne les atteint. `outils/audit-auth.mjs` les lit et dit
lesquels corriger :

```sh
export SUPABASE_ACCESS_TOKEN="sbp_…"    # Account › Access Tokens
node outils/audit-auth.mjs
```

### 1 · Manual Linking — ce qu'il gouverne vraiment

Il gouverne `linkIdentity()` / `unlinkIdentity()` : rattacher une identité
**supplémentaire** (Google, GitHub…) à un compte déjà ouvert.

Autour n'appelle ni l'une ni l'autre. La conversion d'une session anonyme passe
par `updateUser({ email })`, un autre point d'entrée. Ce réglage ne devrait donc
rien changer ici — mais c'est `outils/auth-reel.mjs` qui tranche, en appelant
vraiment le service. **Si le cas « rattacher une adresse à une session anonyme »
échoue avec « Manual linking is disabled », c'est là qu'il faut agir** :

> Authentication › Sign In / Providers › Auth Providers › **Allow manual linking**

### 2 · Le code à six chiffres

Le champ « code » n'est utilisable que si les gabarits contiennent
`{{ .Token }}`. Les gabarits **par défaut ne contiennent que le lien** : sans
modification, le champ est affiché et refuse tout.

> Authentication › Emails › **Magic Link** et **Change Email Address**

Gardez `{{ .ConfirmationURL }}` : le lien reste le chemin principal.

### 3 · Site URL et Redirect URLs

Autour envoie `location.origin + location.pathname` comme redirection. Si cette
origine n'est pas dans la liste, GoTrue renvoie **silencieusement** sur la Site
URL — le lien marche, mais atterrit ailleurs et l'action mise en attente est
perdue. C'est un défaut qu'on ne voit qu'en production.

> Authentication › URL Configuration
> · **Site URL** : `https://autour.eu`
> · **Redirect URLs** : `https://autour.eu/**`, plus les URLs de
>   prévisualisation réellement utilisées — et rien d'autre.

### 4 · SMTP de production

Sans SMTP personnalisé, Supabase utilise son service de démonstration :
quelques courriers par heure, et **uniquement vers les adresses des membres du
projet**. Un vrai utilisateur ne recevrait jamais rien, et ne verrait aucune
erreur — juste un e-mail qui n'arrive pas.

> Authentication › Emails › **SMTP Settings**

Il faut fournir : hôte, port (587 en général), utilisateur, mot de passe,
adresse d'expéditeur sur le domaine (`bonjour@autour.eu`) et nom d'expéditeur.
Le domaine doit avoir ses enregistrements SPF, DKIM et DMARC, sinon le courrier
part en indésirable.

### 5 · Confirmation automatique

`mailer_autoconfirm` confirme les adresses **sans envoyer de courrier**. En
développement c'est commode ; en production, n'importe qui ouvrirait un compte
avec l'adresse de quelqu'un d'autre. Doit rester désactivé.

### 6 · Connexions anonymes

Autour n'en crée plus — `outils/comptes.mjs` compte les appels
d'authentification et vérifie qu'un visiteur reste à zéro. Mais **ne les coupez
pas avant** d'avoir vu passer « MÊME UID » dans `auth-reel.mjs` : c'est le seul
chemin qui rende aux 195 anciennes sessions leurs publications.

## Les bancs d'essai

```sh
node --test tests/comptes.test.mjs             # la règle, les mots, l'attente
AUTOUR_RACINE=autour node outils/comptes.mjs   # les parcours, vrai navigateur
psql -f supabase/tests/rls_comptes.sql         # la propriété, en base
psql -f supabase/tests/migration_anonyme.sql   # la conversion ne perd rien
node outils/audit-auth.mjs                     # la configuration réelle
node outils/auth-reel.mjs                      # le VRAI service (hors bac à sable)
```

Chacun prouve une chose, et une seule :

| Banc | Prouve | Ne prouve pas |
|---|---|---|
| `comptes.test.mjs` | la règle et les mots | rien du réseau |
| `outils/comptes.mjs` | le produit : ce qui est demandé, quand, ce qu'on retrouve | la sécurité, ni le service |
| `rls_comptes.sql` | la propriété, contre un client hostile | le comportement de GoTrue |
| `migration_anonyme.sql` | l'invariant de données : la conversion est un UPDATE | que GoTrue fasse cet UPDATE |
| `audit-auth.mjs` | la configuration réelle du projet | que le courrier arrive |
| `auth-reel.mjs` | **le service lui-même**, bout en bout | — |

`outils/comptes.mjs` bouchonne `auth` : un lien magique arrive par courrier, un
banc automatisé ne peut ni l'attendre ni le lire. C'est pour ça que
`auth-reel.mjs` existe séparément — et qu'il **doit** tourner depuis une machine
qui atteint Supabase. Le bac à sable de développement refuse les connexions
sortantes vers `*.supabase.co` : ce script n'y a jamais tourné.

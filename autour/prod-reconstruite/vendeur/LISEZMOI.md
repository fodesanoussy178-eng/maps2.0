# `vendeur/` — les dépendances servies par notre propre origine

Un seul fichier pour l'instant : le SDK Supabase.

## Pourquoi il est là plutôt que sur un CDN

Il était servi par `cdn.jsdelivr.net`. Ce nom figure sur des listes de
filtrage courantes : un bloqueur de publicités, un réseau d'entreprise ou une
panne du CDN rendaient alors **tout le service de comptes inaccessible** — ni
publication, ni connexion, ni favoris. Une dépendance extérieure décidait
qu'une fonction entière de l'application n'existait plus.

Signalé depuis le terrain sous la forme « Connexion impossible pour le
moment. », avec un bouton qui répondait la même chose indéfiniment.

Un miroir (unpkg) avait été ajouté en premier secours. Ça ne suffit pas : un
filtre qui bloque un CDN par motif les bloque tous. La seule réponse qui tient
est de servir le fichier nous-mêmes. Ce n'est pas un repli, c'est la seule
source : si notre origine tombe, la page elle-même n'est pas là et la question
ne se pose plus.

## Ce que ça coûte, ce que ça rapporte

200 ko bruts, 51 ko compressés. Le fichier reste **chargé paresseusement** —
il ne sert qu'aux comptes et aux publications, et n'est demandé qu'au moment
où quelqu'un en a besoin. Mesuré au banc : demandé après `ui_ready`, jamais
avant. Le premier affichage ne le voit pas.

La version est dans le **nom du fichier**, ce qui le rend immuable par
construction : `vercel.json` archive tout `.js` pour un an, et changer de
version change l'URL. Il n'a donc pas besoin du tampon d'empreinte des modules
(`outils/tamponner.mjs`), contrairement à `core.js` ou `app.js` : ceux-là
changent sans changer de nom, lui non.

Vérifié : deuxième visite, zéro requête serveur pour ce fichier.

## Mettre à jour la version

Le contrat Auth ne doit pas changer au milieu d'une session : la version est
épinglée, et on ne la bouge que délibérément.

```sh
# 1. récupérer le paquet (npm vérifie son intégrité auprès du registre)
cd /tmp && npm pack @supabase/supabase-js@<version>
tar xzf supabase-supabase-js-<version>.tgz package/dist/umd/supabase.js

# 2. l'installer sous son nom versionné
cp package/dist/umd/supabase.js <dépôt>/autour/vendeur/supabase-<version>.js

# 3. pointer le chargeur dessus
#    app.js → const SUPABASE_SDK = Object.freeze(["/vendeur/supabase-<version>.js"]);
#    et mettre à jour l'empreinte notée dans le commentaire au-dessus

# 4. retirer l'ancienne version, puis vérifier
node --test tests/*.test.mjs
node outils/comptes-hors-ligne.mjs      # chargement, reprise après échec réseau
node outils/chemin-critique.mjs --profil=defaut   # toujours hors chemin critique
```

`tests/comptes-reprise.test.mjs` vérifie que le fichier présent est bien la
version que son nom annonce — le paquet publie la sienne à l'intérieur.

## Provenance du fichier actuel

    @supabase/supabase-js@2.108.2 · dist/umd/supabase.js
    récupéré par `npm pack`
    sha256 c123f7e874934778b7d89fee7dce8de26c858a2c3a92fd7a3f870394a6a2f91f

C'est exactement l'artefact que jsDelivr servait : ce CDN republie le contenu
des paquets npm tel quel.

## Ce qui reste sur un CDN tiers, et pourquoi

Leaflet (`cdnjs`), les polices (`fonts.googleapis.com`) et les tuiles de carte
(`basemaps.cartocdn.com`). Aucun des trois ne rend une fonction inaccessible
en cas de blocage :

- Leaflet absent → l'application marche sans carte, elle le dit et continue ;
- polices absentes → le texte s'affiche en police système, immédiatement ;
- tuiles absentes → le fond de carte manque, les marqueurs et les listes non.

Ils ne sont donc pas dans le même cas que le SDK, qui décidait à lui seul de
l'existence des comptes. Si l'un d'eux le devenait, il rejoindrait ce dossier.

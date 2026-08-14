# Checklist Safari iOS — 5 minutes sur autour.eu

À faire sur un **iPhone réel**, dans Safari (pas Chrome iOS, pas une WebView).
Aucun de ces points n'a pu être vérifié automatiquement : WebKit n'est pas
installable dans l'environnement de développement, et `autour.eu` y est
injoignable. Ce sont donc les seules vérifications qui font foi.

Coche ce qui passe. Tout ce qui échoue m'intéresse **avec la version d'iOS**.

---

## 1 · Viewport et barre d'URL (30 s)

- [ ] Ouvrir `autour.eu`. La navigation basse (Explorer / Aide / Créer /
      Favoris / Profil) est **entièrement visible**, pas coupée par le bas.
- [ ] Faire défiler la feuille vers le bas puis le haut : la barre d'URL de
      Safari se réduit et se déploie. **La navigation basse reste visible** et
      ne saute pas.
- [ ] Sur iPhone à encoche : la pastille « Tourcoing » en haut à gauche n'est
      pas sous l'encoche ; la barre basse n'est pas sous la barre d'accueil.

> Ce qui est en jeu : `100dvh` et les `safe-area-inset`. Sur Safari, `100vh`
> inclut la barre d'URL et pousse le bas hors de l'écran.

## 2 · Rebond et défilement (30 s)

- [ ] Tirer la **carte** vers le bas avec le doigt : la page ne doit **pas**
      rebondir ni faire apparaître de bande blanche au-dessus.
- [ ] Tirer la **feuille** (liste du bas) vers le bas : elle se réduit ou se
      ferme, mais la page derrière ne défile pas.
- [ ] Ouvrir une fiche de lieu, faire défiler jusqu'en bas, continuer à
      tirer : pas de double défilement, pas de blocage.

## 3 · Clavier (45 s)

- [ ] Toucher la loupe, taper trois lettres. Le champ **reste visible**,
      il n'est pas recouvert par le clavier.
- [ ] Fermer le clavier (bouton « OK » ou tap ailleurs). La mise en page
      revient exactement comme avant — pas de zone blanche résiduelle en bas.
- [ ] Aller dans **Aide**, toucher « Ou explique-le simplement », taper
      « je dors dehors », valider. Le clavier se ferme et le résultat
      s'affiche sans que l'écran saute.

## 4 · Géolocalisation et permissions (45 s)

- [ ] Au premier chargement, Safari demande la position. **Refuser.**
      → Autour doit proposer « Utiliser ma position » ou « Choisir une ville ».
      Il ne doit **jamais** afficher « Rien autour de toi ».
- [ ] Recharger, **accepter** cette fois. La carte se recentre, la ville en
      haut à gauche change.
- [ ] Réglages iOS → Safari → Position → « Demander ». Recharger : la demande
      revient bien.

## 5 · Toucher et sélection (45 s)

- [ ] Toucher un marqueur sur la carte : la fiche compacte s'ouvre **du
      premier coup** (pas besoin d'appuyer deux fois).
- [ ] Aucun texte ne se sélectionne accidentellement en faisant glisser la
      carte (pas de surlignage bleu).
- [ ] Double-tap sur la carte : elle zoome, elle ne zoome pas *la page*.
- [ ] Pincer pour zoomer : seule la carte zoome.

## 6 · Panneaux et modales (45 s)

- [ ] Ouvrir une fiche de lieu, puis la fermer avec la croix. On revient
      exactement à la même vue de carte, au même endroit.
- [ ] Ouvrir une fiche, puis utiliser le **geste retour** de Safari (glisser
      depuis le bord gauche). La fiche se ferme, la page **ne se recharge pas**.
- [ ] Enchaîner : Explorer → Aide → Explorer → Créer → Explorer.
      **La carte ne doit jamais se reconstruire** (pas de clignotement, pas de
      retour à la position initiale).
- [ ] À aucun moment deux panneaux ne doivent être visibles en même temps.

## 7 · Carte (30 s)

- [ ] Le fond est **clair, gris/beige, sans icônes de commerces Google**.
- [ ] Déplacer la carte rapidement : les marqueurs restent **collés aux rues**,
      ils ne glissent pas indépendamment du fond.
- [ ] Après le déplacement, les marqueurs ne s'accumulent pas et ne laissent
      pas de « fantômes ».

## 8 · Rotation (30 s)

- [ ] Passer en paysage. La navigation basse reste utilisable, la carte occupe
      l'espace, rien n'est coupé.
- [ ] Revenir en portrait. La vue de carte est conservée.

---

## Ce que je n'ai pas pu tester du tout

| Point | Pourquoi |
|---|---|
| Tout ce qui précède, sous WebKit | CDN Playwright refusé par le proxy réseau |
| Le rendu réel de `autour.eu` | `autour.eu` refusé par le proxy réseau |
| Cache CDN / service worker en production | idem |

Ce qui **a** été vérifié statiquement dans le code : `100dvh` partout, aucun
`100vh` actif, `overscroll-behavior:none`, un seul token `--safe-t` pour les
encoches. C'est une lecture du code, pas un test sur appareil — d'où cette
checklist.

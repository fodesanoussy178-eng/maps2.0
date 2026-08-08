# Partager un lieu ou un événement

## Ce qui a changé

Les liens émis étaient de la forme :

```
https://autour.vercel.app/#l=50.71760,3.16110|Le%20Grand%20Mix
```

Un fragment (`#…`) **n'est jamais envoyé au serveur**. Aucune plateforme —
WhatsApp, Messenger, Signal, Slack, Twitter, Discord — ne peut donc en tirer
un titre, une image ou une description : tous les liens partagés affichaient
la même vignette générique, celle de l'application.

Les liens émis sont maintenant des chemins :

| Objet | Lien émis |
|---|---|
| Lieu (OSM, Google) | `/l/<lat>,<lng>/<titre-en-slug>` |
| Événement publié | `/e/<dbId>/<titre-en-slug>` |

`vercel.json` réécrit `/l/:id` et `/e/:id` vers `/index.html`, et
`lieuPartage()` lit le chemin au démarrage.

**Les anciens liens continuent de fonctionner.** `lieuPartage()` accepte les
deux formes ; la lecture de `#l=lat,lng|titre` n'a pas été retirée et ne doit
pas l'être : des liens sont déjà partagés dans des conversations.

## Ce qui manque encore : les métadonnées

Avoir une URL propre est le **prérequis**, pas la solution. Tant que
`/e/123` est servi par le même `index.html` statique, les métadonnées
Open Graph sont celles de l'application.

Pour que chaque événement ait sa vignette, il faut une fonction serveur qui
intercepte `/e/:id`, lise la publication, et renvoie un HTML dont le `<head>`
est complété. Esquisse :

```js
// api/e/[id].js — fonction Vercel
export default async function handler(req, res) {
  const { id } = req.query;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/publications?id=eq.${id}` +
    `&select=titre,description,image_url,adresse,debut_le`,
    { headers: { apikey: SUPABASE_ANON_KEY } });
  const [p] = await r.json();
  if (!p) return res.redirect(302, "/");

  const html = (await lireIndexHtml())
    .replace("</head>", balises(p) + "</head>");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.send(html);
}
```

Les balises à poser :

```html
<meta property="og:type"        content="website">
<meta property="og:title"       content="<titre> · Autour">
<meta property="og:description" content="<description ou date + adresse>">
<meta property="og:image"       content="<image_url ou vignette générée>">
<meta property="og:url"         content="https://autour.vercel.app/e/<id>">
<meta name="twitter:card"       content="summary_large_image">
```

### Points d'attention

- **Échapper le contenu.** Le titre et la description sont écrits par des
  habitants : `"`, `<` et `&` doivent être encodés avant d'entrer dans un
  attribut, sinon la page est cassable depuis un formulaire de publication.
- **Ne rien exposer de plus que la fiche publique.** Le `select` ci-dessus est
  volontairement limité : pas d'`auteur`, pas de contact.
- **Un événement annulé reste partageable**, mais la description doit le dire.
  L'application le fait déjà à l'écran (`annule`), la vignette doit suivre.
- **Les lieux (`/l/…`) n'ont pas d'enregistrement serveur.** Ils viennent
  d'OpenStreetMap ou de Google et ne sont pas stockés. Deux options : se
  contenter du titre présent dans l'URL (suffisant pour un `og:title`), ou
  différer jusqu'à ce que le catalogue géographique existe (voir
  `docs/sortie-overpass.md`, étape 4). La première est honnête et coûte peu :
  le titre vient du lien, l'image reste générique.

### Coût

Une fonction serverless par ouverture de lien partagé — c'est-à-dire très
peu de trafic, et uniquement sur les liens partagés. Le reste du site
demeure statique.

### Pourquoi ce n'est pas fait ici

Cela introduit une dépendance serveur (clé Supabase côté fonction, lecture de
`index.html` à l'exécution) et un chemin de rendu supplémentaire à maintenir.
La passe de finition visait la simplicité et la vitesse perçue ; la partie
qui devait être faite maintenant, c'est l'URL stable — c'est elle qui bloquait
tout le reste, et elle est faite.

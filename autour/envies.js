/* LES ENVIES — ce que la personne a dit vouloir suivre.

   Un modèle de préférences, et rien d'autre. Pas de moteur de
   recommandation, pas d'apprentissage implicite, pas de profilage : la liste
   ne contient QUE ce qui a été coché à la main. C'est la condition pour
   pouvoir dire, sous chaque proposition, pourquoi elle est là.

   Ces choix serviront au classement de « Pour toi » et, plus tard, aux
   notifications. Ils sont donc gardés là où ils survivent à la fermeture de
   l'onglet — et nulle part ailleurs : rien ne part sur le réseau ici.

   Le stockage peut échouer (navigation privée, quota, réglages qui bloquent
   les données de site). Dans ce cas les envies vivent en mémoire pour la
   session : l'interface continue de fonctionner, elle oublie simplement au
   prochain démarrage. Une fonctionnalité de confort ne doit jamais empêcher
   d'utiliser l'application. */
(function(){
  "use strict";

  const CLE = "autour:envies:v1";

  /* Le catalogue est fixe et fermé. Une envie est une étiquette éditoriale —
     ce qu'on va voir —, jamais une catégorie technique d'OpenStreetMap : on
     ne suit pas « amenity=cinema », on suit « Cinéma ».

     `cats` fait le pont vers les catégories d'Autour, `mots` vers le texte
     d'un événement. Les deux servent à RECONNAÎTRE, pas à deviner : sans
     correspondance, l'événement n'est simplement pas rattaché à cette envie. */
  const CATALOGUE = Object.freeze([
    /* Un GENRE ne s'attribue pas une catégorie entière : tous les concerts
       ne sont pas du rap, et écrire « Rap · correspond à ce que tu suis »
       sous un concert de jazz est un mensonge que l'écran affiche. Les envies
       de genre se reconnaissent donc aux mots, jamais à la catégorie. */
    {id:"rap",       label:"Rap",           emoji:"🎤", cats:[],
     mots:["rap","hip-hop","hip hop","trap","rappeur","punchline"]},
    {id:"concerts",  label:"Concerts",      emoji:"🎵", cats:["concert"],
     mots:["concert","live","showcase","set","dj"]},
    {id:"cinema",    label:"Cinéma",        emoji:"🎬", cats:["cinema"],
     mots:["cinema","film","projection","seance","avant-premiere"]},
    {id:"manga",     label:"Manga / Anime", emoji:"🎯", cats:[],
     mots:["manga","anime","japan","cosplay","convention","comics"]},
    {id:"expos",     label:"Expositions",   emoji:"🖼️", cats:["musee"],
     mots:["exposition","expo","vernissage","galerie","musee"]},
    {id:"sport",     label:"Sport",         emoji:"🏅", cats:["sport","terrain"],
     mots:["sport","match","tournoi","course","marathon"]},
    {id:"football",  label:"Football",      emoji:"⚽", cats:[],
     mots:["football","foot","losc","stade","ligue 1"]},
    {id:"mode",      label:"Mode",          emoji:"👗", cats:[],
     mots:["mode","defile","fashion","createur","friperie"]},
    {id:"food",      label:"Food",          emoji:"🍽️", cats:["marche"],
     mots:["food","street food","degustation","brunch","marche gourmand"]},
    {id:"nuit",      label:"Vie nocturne",  emoji:"🌙", cats:[],
     mots:["soiree","club","nuit","after","bal"]},
    {id:"famille",   label:"Famille",       emoji:"🧸", cats:["parc"],
     mots:["famille","enfants","jeune public","atelier enfant"]},
    {id:"theatre",   label:"Théâtre",       emoji:"🎭", cats:["spectacle"],
     mots:["theatre","piece","scene","comedie","impro"]},
    {id:"festivals", label:"Festivals",     emoji:"🎪", cats:[],
     mots:["festival","fete","carnaval","braderie"]},
  ]);

  const PAR_ID = new Map(CATALOGUE.map(e=>[e.id, e]));

  /* Le repli mémoire : utilisé seulement quand l'écriture est impossible. */
  let enMemoire = null;
  let stockageMuet = false;

  function lire(){
    if(enMemoire) return enMemoire;
    let brut = null;
    try{ brut = localStorage.getItem(CLE); }
    catch(e){ stockageMuet = true; }
    let ids = [];
    try{
      const lu = JSON.parse(brut || "[]");
      /* On ne garde que ce que le catalogue connaît. Une envie retirée du
         catalogue disparaît d'elle-même, sans migration ni écran cassé. */
      if(Array.isArray(lu)) ids = lu.filter(id=>PAR_ID.has(id));
    }catch(e){ ids = []; }
    enMemoire = ids;
    return enMemoire;
  }

  function ecrire(ids){
    enMemoire = ids.filter(id=>PAR_ID.has(id));
    if(stockageMuet) return false;
    try{ localStorage.setItem(CLE, JSON.stringify(enMemoire)); return true; }
    catch(e){ stockageMuet = true; return false; }
  }

  /* ---- L'interface publique ---------------------------------------------- */

  /* Les identifiants choisis, dans l'ordre du catalogue — pour que la liste
     s'affiche toujours pareil, quel que soit l'ordre des clics. */
  function choisies(){
    const prises = new Set(lire());
    return CATALOGUE.filter(e=>prises.has(e.id)).map(e=>e.id);
  }

  const suivie = (id)=>lire().indexOf(id) >= 0;

  function definir(id, actif){
    if(!PAR_ID.has(id)) return choisies();
    const prises = new Set(lire());
    if(actif) prises.add(id); else prises.delete(id);
    ecrire([...prises]);
    return choisies();
  }

  const basculer = (id)=>definir(id, !suivie(id));

  /* Les descripteurs complets, pour l'affichage. */
  const detail = (id)=>PAR_ID.get(id) || null;
  const details = ()=>choisies().map(id=>PAR_ID.get(id));

  /* ---- Reconnaître ce qui relève d'une envie ------------------------------

     Rendu : les envies auxquelles cet objet se rattache, du plus au moins
     sûr. Une correspondance de catégorie est plus solide qu'une
     correspondance de mot — « Cinéma » sur un lieu tagué cinéma ne se discute
     pas, alors que le mot « film » dans un titre peut désigner autre chose.

     Aucune correspondance n'est inventée : sans catégorie ni mot reconnu, la
     liste est vide et l'appelant n'affiche rien. */
  function sansAccents(v){
    return String(v || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  }

  function correspondances(objet, seulementSuivies){
    if(!objet) return [];
    const cat = objet.cat || objet.categorie || "";
    const texte = sansAccents([objet.titre, objet.title, objet.description,
      objet.categorieLabel, (objet.tags && objet.tags.name)].filter(Boolean).join(" "));
    const candidates = seulementSuivies === false ? CATALOGUE : details();
    const trouvees = [];
    candidates.forEach(e=>{
      if(!e) return;
      if(cat && e.cats.indexOf(cat) >= 0){ trouvees.push({id:e.id, sur:"categorie"}); return; }
      const mot = e.mots.find(m=>texte.indexOf(sansAccents(m)) >= 0);
      if(mot) trouvees.push({id:e.id, sur:"mot", mot});
    });
    /* La catégorie d'abord : c'est la preuve la plus solide. */
    return trouvees.sort((a,b)=>(a.sur === "categorie" ? 0 : 1) - (b.sur === "categorie" ? 0 : 1));
  }

  /* La phrase affichée sous une proposition. Elle nomme l'envie qui l'a fait
     remonter — jamais une justification vague comme « ça pourrait te plaire ».
     Sans envie reconnue, il n'y a rien à dire, et on ne dit rien. */
  function pourquoi(objet){
    const trouvees = correspondances(objet);
    if(!trouvees.length) return null;
    const e = PAR_ID.get(trouvees[0].id);
    if(!e) return null;
    return {
      envie: e.id,
      label: e.label,
      emoji: e.emoji,
      /* « correspond fortement » n'est pas un score inventé : c'est la
         différence entre une catégorie reconnue et un simple mot du titre. */
      texte: trouvees[0].sur === "categorie"
        ? e.label+" · correspond à ce que tu suis"
        : e.label+" · repéré dans l’annonce",
      solide: trouvees[0].sur === "categorie",
    };
  }

  /* Le stockage a-t-il vraiment pris ? L'interface peut le dire à qui navigue
     en privé, plutôt que de laisser croire que le choix est retenu. */
  const persistant = ()=>{ lire(); return !stockageMuet; };

  /* Uniquement pour les tests : repartir d'un état connu. */
  function _reinitialiser(){
    enMemoire = null; stockageMuet = false;
    try{ localStorage.removeItem(CLE); }catch(e){}
  }

  window.AutourEnvies = {
    CATALOGUE, CLE,
    choisies, suivie, definir, basculer, detail, details,
    correspondances, pourquoi, persistant, _reinitialiser,
  };
})();

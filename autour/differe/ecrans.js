/* ======================================================================== *
 *  Les écrans qu'on n'ouvre pas en arrivant                                *
 * ======================================================================== *

   Ce fichier ne part PAS avec la page. Il porte les écrans qui n'existent
   qu'après un geste : la fiche d'un lieu, l'itinéraire, la publication, le
   compte, le profil et les canaux. Personne n'en a besoin pour voir « Autour
   de toi », et les télécharger d'abord retardait tout le reste — sur un
   réseau mobile, chaque kilo-octet du chemin critique est du temps pendant
   lequel l'écran ne répond à rien.

   C'est un script CLASSIQUE, pas un module : il partage donc la portée de
   `app.js` — ses `let`, ses `const`, ses fonctions. Rien n'a été
   réécrit en le déplaçant, et chaque fonction ci-dessous REMPLACE l'amorce
   du même nom posée dans `app.js` : dès que ce fichier est là, les appels
   suivants ne passent plus par le chargeur.

   `app.js` le demande de deux façons : à l'inactivité, juste après le
   démarrage — pour que le premier appui ne paie jamais l'attente — et à la
   demande, si le geste arrive avant. */

/* ---- Renvoyer le code : un nouvel OTP, jamais l'ancien -------------------

   Chaque envoi génère un jeton neuf côté serveur ; l'ancien n'est plus jamais
   présenté. Le renvoi n'est donc pas un cas à part : c'est le MÊME appel
   (`envoyerLienCompte`), qui repasse par la même manœuvre — `updateUser` pour
   une session anonyme, `signInWithOtp` pour une session neuve — et régénère
   donc un jeton du MÊME type que celui qu'on vérifiera. Passer par une autre
   porte au renvoi (ex. toujours `signInWithOtp`) changerait le type du jeton
   entre l'envoi et la vérification : c'est exactement le mélange à éviter.

   Le délai n'est pas cosmétique. Supabase limite l'envoi à une adresse à un
   courrier par minute : sans garde-fou, un second clic part dans le vide et
   ramène « Trop de tentatives », et la personne croit que RIEN ne marche. On
   bloque donc le bouton une minute, avec un décompte visible. */
const RENVOI_COMPTE_MS = 60000;
let renvoiCompteAvant = 0;     // horodatage jusqu'auquel le renvoi est bloqué
let renvoiCompteMinuteur = null;

async function enregistrerProfilCompte(champs){
  if(!sb || !moiId) return false;
  const { error } = await sb.from("profiles").update(champs).eq("id", moiId);
  if(error){ console.error("Profil non enregistré :", error.message); return false; }
  monProfil = Object.assign({}, monProfil, champs);
  if(Object.prototype.hasOwnProperty.call(champs, "display_name")){
    monPseudo = champs.display_name || "";
    try{ localStorage.setItem(CLE_PSEUDO_CREATEUR, monPseudo); }catch(e){}
  }
  return true;
}

/* Envoi du lien (et du code). Deux chemins, et le choix décide de tout :
   rattacher l'adresse à une session anonyme CONSERVE l'uid, donc les
   publications et les favoris déjà posés. Ouvrir une session neuve en
   créerait un autre, et l'ancien deviendrait inaccessible. */
async function envoyerLienCompte(email){
  /* `demande:true` : c'est un geste explicite, on prend le temps qu'il faut.
     Et si le service reste injoignable, on dit CE QUI se passe et QUOI faire —
     « Connexion impossible pour le moment. » laissait appuyer indéfiniment sur
     un bouton qui répondait la même chose en zéro milliseconde. */
  if(!(await connecter({demande:true}))) return { ok:false, message:MESSAGE_SERVICE_INJOIGNABLE };
  const adresse = COMPTES.normaliserEmail(email);
  if(!COMPTES.emailValide(adresse)) return { ok:false, message:"Cette adresse ne semble pas complète." };
  const plan = COMPTES.manoeuvre(etatCompte);

  /* Ouvrir une session neuve : c'est le cas du visiteur qui n'a jamais rien
     posé. Rien à conserver, donc rien à rattacher. */
  const ouvrir = async()=>{
    const { error } = await sb.auth.signInWithOtp({ email:adresse,
      options:{ emailRedirectTo: location.origin + location.pathname, shouldCreateUser:true } });
    if(error) throw error;
    return { ok:true, typeOtp:"email" };
  };

  if(plan.methode !== "lier") {
    try{ return await ouvrir(); }
    catch(e){ return { ok:false, message: COMPTES.messageErreur(e) }; }
  }

  /* Rattacher l'adresse à la session anonyme en cours : c'est ce qui conserve
     l'uid, donc les publications et les favoris déjà posés.

     MAIS ÇA PEUT ÉCHOUER, ET IL FAUT LE PRÉVOIR. Si l'adresse appartient déjà
     à un autre compte, le rattachement est refusé — deux comptes ne peuvent
     pas porter la même adresse, et la base le garantit par un index unique.
     Sans repli, la personne resterait bloquée : elle taperait l'adresse de son
     propre compte et n'arriverait jamais à s'y connecter.

     On bascule donc sur une ouverture de session normale. Elle retrouve son
     vrai compte — avec ce qu'il contient — et la session anonyme du moment est
     abandonnée. C'est le bon arbitrage : ce qu'elle a déjà publié sous son
     compte vaut plus qu'une session de navigateur. */
  try{
    const { error } = await sb.auth.updateUser({ email:adresse });
    if(error) throw error;
    return { ok:true, typeOtp:plan.typeOtp };
  }catch(e){
    if(COMPTES.adresseDejaPrise(e)){
      try{
        const r = await ouvrir();
        return Object.assign(r, { bascule:"adresse-deja-prise" });
      }catch(e2){ return { ok:false, message: COMPTES.messageErreur(e2) }; }
    }
    return { ok:false, message: COMPTES.messageErreur(e) };
  }
}

async function verifierCodeCompte(email, code, typeOtp){
  if(!sb && !(await connecter({demande:true})))
    return { ok:false, message:MESSAGE_SERVICE_INJOIGNABLE };
  const adresse = COMPTES.normaliserEmail(email);
  if(!COMPTES.codeValide(code)) return { ok:false, message:"Le code fait six chiffres." };
  try{
    const { data, error } = await sb.auth.verifyOtp({
      email:adresse, token:String(code).trim(), type:typeOtp || "email" });
    if(error) throw error;
    appliquerSession(data && data.session);
    return { ok:estConnecte(), message: estConnecte() ? "" : "Adresse non confirmée." };
  }catch(e){
    return { ok:false, message: COMPTES.messageErreur(e) };
  }
}

async function seDeconnecter(){
  if(!sb) return;
  try{ await sb.auth.signOut(); }catch(e){}
  appliquerSession(null);
  monProfil = null;
  /* Les favoris affichés viennent du compte : les laisser à l'écran après une
     déconnexion ferait croire qu'ils sont encore là. */
  favorisIds.clear();
  favorisEnMemoire.clear();
  canauxAMoi = [];
  if(COMPTES) COMPTES.oublierAttente();
  majCoeurs(); majNavBas();
  toast("Déconnecté");
}

function ouvrirFicheCompacte(l){
  if(!l) return;
  mettreEnAvant(l.id);
  /* Sur téléphone, la feuille occupe 58 % de l'écran : une fiche posée sur la
     carte s'y superposait, illisible. On réduit donc la feuille le temps de
     lire la fiche — la décision est prise, la carte reprend la main. Elle se
     redéplie d'un geste sur la poignée. */
  if(!responsiveLayoutState.isDesktop && feuilleNiveau !== null)
    reglerEtatFeuille("reduite");
  favorisEnMemoire.set(cleFavori(l), l);
  const d = dispoDe(l);
  const centre = positionMoi;
  const dist = centre ? distanceM(centre[0],centre[1],l.lat,l.lng) : null;
  const min = (kmh)=> dist == null ? null : tempsTrajetMinutes(dist, kmh);

  const etiquettes = etiquettesLisibles(l);
  const ligne2 = [
    l.note ? "⭐ "+l.note.toFixed(1).replace(".",",")+
      (l.avis ? " ("+Number(l.avis).toLocaleString("fr-FR")+" avis)" : "") : null,
    ...etiquettes,
  ].filter(Boolean).join(" · ");
  // l'annulation passe devant tout le reste : c'est la seule chose qui compte,
  // puis la date réelle de l'événement, puis seulement la distance
  const quandFiche = estTemporaire(l) && !l.annule
    ? TEMPS.libelleTemporel(l, instantCreneau().getTime(),
        {disponibilite:(x,t)=>dispoDe(x, null, t)})
    : null;
  const ligne3 = [
    l.annule ? "Annulé" : (quandFiche || (d && d.status !== "unknown" ? d.label : null)),
    dist != null ? formatDist(dist) : null,
  ].filter(Boolean).join(" · ");

  const modes = [
    ["🚶", min(VITESSES_KMH.pied)],
    ["🚲", min(VITESSES_KMH.velo)],
  ].filter(([,m])=>m != null).map(([e,m])=>e+" "+m+" min").join("  ");

  const mien = estPublicationAMoi(l);
  // un lieu d'aide dit à quoi il sert dès la fiche posée sur la carte :
  // ouvrir le détail pour comprendre ce qu'est un CCAS est un pas de trop
  const aQuoi = EXPLIQUE && SET_AIDE.has(l.cat) ? EXPLIQUE.resumeCourt(l, 130) : "";
  $("#ficheCompacte").innerHTML =
    '<div class="fc-tete"><b>'+esc(l.titre)+'</b>'+boutonCoeur(l)+'</div>'+
    (aQuoi ? '<span class="fc-expli">'+esc(aQuoi)+'</span>' : '')+
    (ligne2 ? '<span class="fc-l2">'+esc(ligne2)+'</span>' : '')+
    (ligne3 ? '<span class="fc-l3">'+esc(ligne3)+'</span>' : '')+
    (modes ? '<span class="fc-modes">'+modes+'</span>' : '')+
    '<div class="fc-actions">'+
      '<button class="fc-y">Y aller</button>'+
      '<button class="fc-voir">Voir</button>'+
      (l.dbId ? '<button class="fc-part">Partager</button>' : '')+
      (mien ? '<button class="fc-prevenir">Prévenir</button>' : '')+
    '</div>';
  const f = $("#ficheCompacte");
  f.hidden = false;
  f.querySelector(".fc-voir").onclick = ()=>{
    fermerFicheCompacte(); pileEcrans=[]; pousserEcran(()=>ouvrirDetail(l.id));
  };
  /* « Y ALLER » ALLAIT AU MÊME ENDROIT QUE « VOIR ».
     Les deux boutons ouvraient la fiche, côte à côte, et il fallait ensuite y
     retrouver « Y aller » pour obtenir enfin les temps de trajet. Deux gestes
     et une deuxième lecture pour une intention qui était déjà claire au
     premier appui.
     Et ils n'ouvraient pas la fiche de la même façon : « Voir » passait par la
     pile d'écrans, « Y aller » non — le bouton retour du téléphone ne se
     comportait donc pas pareil selon celui des deux qu'on avait touché.
     Même chemin d'ouverture pour les deux, et « Y aller » déplie le trajet
     dans la foulée : on touche, Autour répond. */
  f.querySelector(".fc-y").onclick = ()=>{
    fermerFicheCompacte(); pileEcrans=[];
    /* « Y aller » depuis la carte ouvre la fiche ET bascule aussitôt : on
       arrive directement sur les moyens de s'y rendre, sans traverser la
       fiche du lieu. */
    pousserEcran(()=>{ ouvrirDetail(l.id); afficherTrajet(l); });
  };
  if(f.querySelector(".fc-part")) f.querySelector(".fc-part").onclick = ()=>partagerInviter(l);
  if(f.querySelector(".fc-prevenir")) f.querySelector(".fc-prevenir").onclick = ()=>{
    fermerFicheCompacte(); pileEcrans=[]; pousserEcran(()=>ouvrirDetail(l.id));
  };
}

function continuerPublication(){
  $("#abandonVoile").hidden=true;
  layerManager.deactivate(NOMS_COUCHES.confirmationDialog);
  actionApresAbandon = null;
  const cible = $("#feuille").querySelector("input,button,select,textarea");
  if(cible) cible.focus();
}

function faitsAide(l){
  const explication = EXPLIQUE ? EXPLIQUE.explication(l) : null;
  const condition = AIDE ? AIDE.conditionDe(l) : null;
  const rendezVous = AIDE ? AIDE.rendezVousDe(l) : null;
  const cout = l.gratuit === true ? "Gratuit" : Number.isFinite(Number(l.prix)) ? Number(l.prix)+" €" : "Non renseigné";
  const faits = [
    [estTemporaire(l) ? "Quand" : "Statut", statutAide(l)],
    ["Horaires", libelleHoraires(l)],
    ["Public accueilli", explication && explication.public],
    ["Conditions d’accès", condition && condition.texte],
    ["Rendez-vous", rendezVous && rendezVous.label],
    ["Coût", cout],
    ["Source", sourceAide(l)],
    ["Dernière mise à jour", dateMiseAJourAide(l)],
  ].filter(([,valeur])=>!!valeur);
  return '<dl class="faits faits-aide">'+faits.map(([titre, valeur])=>
    '<div><dt>'+esc(titre)+'</dt><dd>'+esc(valeur)+'</dd></div>').join("")+'</dl>';
}

function ouvrirDetail(id){
  const l = lieux.find(x=>x.id===id); if(!l) return;
  const c = categorieAffichee(l);
  const mien = estPublicationAMoi(l);
  const ficheAide = estFicheAide(l);
  const prix = l.gratuit === true ? "Gratuit" : Number.isFinite(Number(l.prix)) ? Number(l.prix)+" €" : "";
  const site = urlSiteSure(l.url);

  /* DEUX PANNEAUX, UNE SEULE FEUILLE.

     `Y aller` ne déplie plus un bloc au bas de la fiche : il BASCULE. Le
     panneau du lieu est masqué d'un coup, celui du déplacement le remplace.
     Aucun rendu n'est refait, aucune requête n'est relancée — les deux
     panneaux coexistent dans le même DOM, et « Retour » ne fait que les
     échanger. C'est ce qui rend la bascule instantanée, et c'est aussi ce qui
     garantit que la fiche revient EXACTEMENT dans l'état où on l'a quittée,
     défilement compris. */
  ouvrirFeuille(
    '<div class="d-lieu" id="ficheLieu">'+
    (ficheAide ? couvertureAide(l, c) : couvertureLieu(l, c))+
    '<div class="d-haut"><span class="tag"><span>'+c.emoji+'</span>'+c.label+'</span>'+
    (prix ? '<span class="prix-tag '+(l.gratuit?'g':'')+'">'+esc(prix)+'</span>' : '')+'</div>'+
    '<h2 class="titre">'+esc(l.titre)+'</h2>'+
    (l.annule ? '<p class="non-verifie"><b>Annulé par l’organisateur.</b> '+
      'La publication reste visible pour éviter un déplacement inutile.</p>' : '')+
    /* L'essentiel d'abord — où, combien de temps, ouvert, quelle réputation —
       puis les quatre gestes utiles. Le détail vit plus bas. */
    '<p class="resume">'+
      '<span>'+formatDist(distanceDepuisZone(l))+'</span>'+
      '<span>'+tempsTrajetMinutes(distanceDepuisZone(l),
              VITESSES_KMH.pied)+' min à pied</span>'+
      badgeDispo(l)+
      (l.note ? '<span>★ '+l.note.toFixed(1)+(l.avis?' ('+l.avis+')':'')+'</span>' : '')+
      (l.pmr === true ? '<span title="Accessible en fauteuil">♿</span>' : '')+
    '</p>'+
    '<div class="actions">'+
      '<button class="act act-1" id="btnYAller">'+(ficheAide?'Itinéraire':'Y aller')+'</button>'+
      (l.tel ? '<a class="act" href="tel:'+esc(l.tel.replace(/\s/g,""))+'">Appeler</a>'
        : '<button class="act" type="button" disabled aria-label="Téléphone non renseigné">Appeler</button>')+
      (site ? '<a class="act" href="'+esc(site)+'" target="_blank" rel="noopener">Site web</a>'
        : '<button class="act" type="button" disabled aria-label="Site non renseigné">Site web</button>')+
      /* La billetterie n'apparaît QUE si une source vérifiée en a trouvé une.
         Un bouton « Billetterie » qui mène nulle part est pire que son
         absence : il fait cliquer pour rien quelqu'un qui voulait y aller. */
      (l.ticket_url
        ? '<a class="act" href="'+esc(l.ticket_url)+'" target="_blank" rel="noopener">Billetterie</a>'
        : '')+
      '<button class="act" id="btnPartLieu">Partager</button>'+
      '<button class="act" id="btnGarder">'+(estGarde(l.id)?'Favori ajouté':'Favori')+'</button>'+
    '</div>'+
    (l.service ? '<p class="service-bloc">'+esc(l.service)+'</p>' : '')+
    // « CCAS », « Mission locale », « Banque alimentaire » : des noms qui ne
    // disent rien à qui n'a jamais eu à s'en servir — c'est-à-dire à qui ouvre
    // cet écran. Chaque fiche explique donc ce qu'on y fait.
    blocExplication(l)+
    // un établissement scolaire trouvé par son nom en pleines vacances : le
    // dire évite un déplacement pour rien devant une grille fermée
    noteVacances(l)+
    // une fausse distribution fait se déplacer quelqu'un qui n'a pas de quoi manger
    (estTemporaire(l) && !l.verifie && /alimentaire|collecte|hebergement/.test(l.cat)
      ? '<p class="non-verifie">Annonce publiée par un habitant, non vérifiée. '+
        'Renseigne-toi avant de te déplacer.</p>' : '')+
    '<address class="adresse"><span class="ad-rue">'+esc(l.adresse || "")+'</span>'+
    '<span class="ad-ville">'+esc(l.cp || "")+'</span>'+
    '</address>'+
    (ficheAide ? faitsAide(l) : '<dl class="faits">'+
      '<div><dt>Quand</dt><dd>'+
        (l.ouvert === true  ? '<span class="ouvert">Ouvert</span> · ' :
         l.ouvert === false ? '<span class="ferme">Fermé</span> · '   : '')+
        esc(libelleHoraires(l))+'</dd></div>'+
      '<div><dt>Places</dt><dd>'+(l.places==null?'Entrée libre':l.places+' places')+'</dd></div>'+
      '<div><dt>Posté par</dt><dd>'+esc(l.par)+'</dd></div>'+
    '</dl>')+
    horairesSemaine(l)+
    (l.gratuit ? '' :
      '<div class="sans-billet">Le paiement se fait sur place, entre vous. '+
      'L’app n’encaisse rien.</div>')+
    // annonces du canal : d'abord ce qui a changé, car c'est ce qui décide
    // si on se déplace encore
    '<div id="canalBloc"></div>'+
    '<div class="liens">'+
    '<button id="btnInviter" class="lien-fort">Partager / Inviter</button>'+
    (mien
      ? '<button id="btnModifier">Modifier</button>'+
        (l.annule ? '' : '<button id="btnAnnuler" class="lien-danger">Annuler</button>')+
        '<button id="btnSupprimer" class="lien-danger">Supprimer définitivement</button>'
      : '<button id="btnSignal">Signaler</button>')+
    '</div>'+
    '</div>'+
    '<div class="itin" id="ficheItineraire" hidden></div>'
  );
  if($("#btnSignal")) $("#btnSignal").onclick=()=>{ fermerFeuille(); toast("Signalement envoyé"); };
  if($("#btnInviter")) $("#btnInviter").onclick=()=>partagerInviter(l);
  completerExplication(l);
  if(l.dbId) chargerCanal(l);

  const modifier = $("#btnModifier");
  if(modifier) modifier.onclick = async ()=>{
    await chargerCanal(l);
    const actions = $("#canalBloc");
    if(actions){
      actions.scrollIntoView({behavior:"smooth", block:"start"});
      const premier = actions.querySelector("[data-act]");
      if(premier) premier.focus();
    }
    toast("Choisis ce que tu veux modifier");
  };
  const annuler = $("#btnAnnuler");
  if(annuler) annuler.onclick = ()=>annulerPublication(l);

  /* Suppression en deux temps : un appui demande confirmation, le second
     supprime. Rien d'irréversible sur un simple effleurement. */
  const sup = $("#btnSupprimer");
  if(sup) sup.onclick = async ()=>{
    if(sup.dataset.sur !== "1"){
      sup.dataset.sur = "1";
      sup.textContent = "Confirmer la suppression";
      return;
    }
    if(l.dbId && !(await Store.supprimer(l.dbId))){
      toast("Suppression impossible"); return;
    }
    userPublications = userPublications.filter(p=>p.id !== l.id);
    reconstruireLieux();
    fermerFeuille(); rendre(); dessinerFiltres();
    toast("Événement supprimé");
  };
  $("#btnPartLieu").onclick=()=>partagerLieu(l);
  $("#btnGarder").onclick=(e)=>{
    e.target.textContent = basculerGarde(l.id) ? (ficheAide ? "Favori ajouté" : "Enregistré") : (ficheAide ? "Favori" : "Enregistrer");
    e.target.classList.toggle("act-on", estGarde(l.id));
  };
  $("#btnYAller").onclick=()=>afficherTrajet(l);
}

async function annulerPublication(l){
  if(!l || !estPublicationAMoi(l)) return false;
  if(!confirm("Annuler l’événement ? Il restera visible avec la mention « Annulé par l’organisateur » et les participants seront prévenus.")) return false;
  if(!(await Store.annuler(l.dbId))){ toast("Annulation impossible"); return false; }
  l.status = "cancelled";
  l.annule = true;
  userPublications.forEach(p=>{ if(p.dbId === l.dbId){ p.status="cancelled"; p.annule=true; } });
  reconstruireLieux();
  rendre(); dessinerFiltres();
  ouvrirDetail(l.id);
  toast("Événement annulé · il reste visible");
  return true;
}

/* ---- mode navigation : la carte prend tout l'écran, seul le trajet reste ---- */
function entrerNav(option, titre){
  modeNav = true;
  document.body.classList.add("nav");
  $("#voile").hidden = true; $("#feuille").hidden = true;
  ["#navBas","#appHeader","#btnPartager","#btnAide","#btnTransports","#attribution","#filtresHumains","#feuilleBesoins","#bandeauVide"]
    .forEach(s=>{ const el=$(s); if(el) el.hidden = true; });
  feuilleNiveau = null;
  $("#navMode").textContent = EMOJI_MODE[option.mode] || "";
  $("#navTxt").textContent  = LABEL_MODE[option.mode]+" · "+option.min+" min → "+titre;
  $("#navBarre").hidden = false;
  rendre();                              // les autres marqueurs s'effacent
  dessinerSegments(option.segments);     // recadrage sur la totalité du parcours
}

async function itineraireOSRM(profil, depart, arrivee){
  const base = OSRM_PROFILS[profil];
  if(!base) return null;
  try{
    const stop = new AbortController();
    const t = setTimeout(()=>stop.abort(), 6000);
    const coord = depart[1]+","+depart[0]+";"+arrivee[1]+","+arrivee[0];
    const r = await fetch(base+coord+"?overview=full&geometries=geojson", {signal:stop.signal});
    clearTimeout(t);
    if(!r.ok) return null;
    const j = await r.json();
    const route = j.routes && j.routes[0];
    if(!route || !route.geometry) return null;
    return {
      min: Math.max(1, Math.round(route.duration/60)),
      /* La distance ROUTÉE, pas celle à vol d'oiseau : c'est le chemin qu'on
         va réellement parcourir que la carte de mode annonce. */
      m: Number.isFinite(route.distance) ? route.distance : null,
      coords: route.geometry.coordinates.map(c=>[c[1],c[0]])
    };
  }catch(e){ return null; }
}

/* un segment d'itinéraire : routé réellement si OSRM répond, sinon ligne
   droite avec une estimation par vitesse moyenne (clairement indiqué à l'affichage) */
async function segmentTrajet(profil, depart, arrivee){
  const d = distanceM(depart[0],depart[1],arrivee[0],arrivee[1]);
  const reel = await itineraireOSRM(profil, depart, arrivee);
  if(reel) return { coords:reel.coords, reel:true, min:reel.min, m:reel.m == null ? d : reel.m };
  return { coords:[depart,arrivee], reel:false, m:d,
           min: tempsTrajetMinutes(d, VITESSES_KMH[profil]||15) };
}

function dessinerSegments(segments){
  // avant d'écraser la vue par le cadrage de l'itinéraire, retenir celle qu'on
  // avait — c'est elle qu'on rendra en fermant la fiche
  if(!vueAvantTrajet && map){
    const c = map.getCenter();
    vueAvantTrajet = {centre:[c.lat, c.lng], zoom:map.getZoom()};
  }
  effacerLignes();
  ligneCouches = [];
  const points = [];
  segments.forEach(seg=>{
    const c = L.polyline(seg.coords, {
      color:"#FF4A17", weight:3, opacity:.85,
      dashArray: seg.reel ? null : "4 8"
    }).addTo(map);
    ligneCouches.push(c);
    points.push(...seg.coords);
  });
  // la feuille de détail couvre le bas de l'écran : on cadre l'itinéraire
  // dans la bande encore visible, sinon le tracé est dessiné sous la feuille
  if(points.length){
    surLaCarte((m)=>{
      const feuille = $("#feuille");
      // en navigation la feuille est masquée : le trajet dispose de tout l'écran
      const cache = (!modeNav && feuille && !feuille.hidden)
        ? feuille.getBoundingClientRect().height : 0;
      const hauteur = m.getSize().y;
      m.fitBounds(L.latLngBounds(points), {
        paddingTopLeft:[30,30],
        paddingBottomRight:[30, Math.min(cache + 20, Math.max(hauteur - 140, 40))],
        maxZoom:16
      });
    }, "deplacement");
  }
}

/* Les liens sont de simples ancres : aucun SDK, listener ou état partagé.
   Google Maps et Apple Plans reçoivent origine et destination ; Waze ouvre la
   destination et utilise la position courante, conformément à son URL publique. */
function urlItineraireExterne(fournisseur, mode, depart, destination){
  const origine = depart ? coordonneeItineraire(depart) : "";
  const arrivee = coordonneeItineraire(destination);
  if(fournisseur === "google"){
    return "https://www.google.com/maps/dir/?api=1"+
      (origine ? "&origin="+encodeURIComponent(origine) : "")+
      "&destination="+encodeURIComponent(arrivee)+
      "&travelmode="+(mode === "transit" ? "transit" : "driving");
  }
  if(fournisseur === "apple"){
    return "https://maps.apple.com/?"+
      (origine ? "saddr="+encodeURIComponent(origine)+"&" : "")+
      "daddr="+encodeURIComponent(arrivee)+
      "&dirflg="+(mode === "transit" ? "r" : "d");
  }
  return "https://www.waze.com/ul?ll="+encodeURIComponent(arrivee)+"&navigate=yes";
}

/* ---- Les pictogrammes du mode itinéraire --------------------------------
   Même vocabulaire que le reste de l'application : un trait de 24 sur 24,
   sans remplissage, qui prend la couleur du texte. Aucune police d'icônes,
   aucun fichier à télécharger — quatre chemins écrits ici. */
const TRAITS_MODE = {
  pied: '<circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/>'+
        '<path d="m6 8 6 2 6-2"/><path d="M12 10v4"/>',
  velo: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/>'+
        '<circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  voiture: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10'+
           's-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9'+
           'A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/>'+
           '<path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  transports: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>'+
              '<path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5'+
              'C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/>'+
              '<path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
};

function traitSvg(chemins, taille, epaisseur){
  return '<svg viewBox="0 0 24 24" width="'+taille+'" height="'+taille+'" fill="none" '+
    'stroke="currentColor" stroke-width="'+epaisseur+'" stroke-linecap="round" '+
    'stroke-linejoin="round" aria-hidden="true">'+chemins+'</svg>';
}

const iconeMode = (mode)=>traitSvg(TRAITS_MODE[mode] || "", 23, 1.8);
const CHEVRON_ITIN = '<path d="m9 18 6-6-6-6"/>';
const FLECHE_RETOUR = '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>';
/* Une flèche qui sort d'un cadre : ces boutons quittent Autour. Les logos des
   marques ne sont pas reproduits — aucun fichier de marque n'existe dans le
   dépôt, et une approximation dessinée à la main serait un faux logo. */
const SORTIE_APPLI = '<path d="M14 4h6v6"/><path d="M20 4 11 13"/>'+
  '<path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';

/* Une carte du panneau : cercle de couleur très légère, nom du mode bien
   lisible, détail secondaire dessous. La cible tactile fait toute la carte
   quand le mode est routé par Autour. */
function carteMode(opts){
  const detail = opts.detail
    ? '<span class="itin-detail">'+esc(opts.detail)+'</span>' : '';
  const dedans =
    '<span class="itin-rond itin-rond-'+opts.cle+'">'+iconeMode(opts.cle)+'</span>'+
    '<span class="itin-txt"><b>'+opts.titre+'</b>'+detail+'</span>'+
    (opts.fin || "");
  return opts.action
    ? '<button type="button" class="itin-mode itin-mode-interne" '+opts.action+'>'+dedans+'</button>'
    : '<div class="itin-mode itin-mode-ext" data-mode-externe="'+opts.cle+'">'+dedans+'</div>';
}

/* Voiture et transports ne sont pas routés par Autour — ils partent chez les
   applications qui le font pour de vrai. Chaque carte porte donc ses
   fournisseurs, et rien d'autre : une durée inventée pour ressembler à une
   maquette serait un chiffre que personne ne peut vérifier. */
function liensItinerairesExternes(depart, destination){
  const lien = (label, fournisseur, mode)=>
    '<a class="itin-lien" target="_blank" rel="noopener" data-provider="'+fournisseur+'" href="'+
      esc(urlItineraireExterne(fournisseur, mode, depart, destination))+'">'+
      '<span class="itin-lien-marque" aria-hidden="true">'+traitSvg(SORTIE_APPLI, 15, 1.9)+'</span>'+
      '<span>'+label+'</span></a>';
  return carteMode({
      cle:"voiture", titre:"Voiture", detail:"Ouvrir l’itinéraire",
      fin:'<span class="itin-liens">'+
        lien("Google Maps", "google", "driving")+
        lien("Apple Plans", "apple", "driving")+
        lien("Waze", "waze", "driving")+'</span>',
    })+
    carteMode({
      cle:"transports", titre:"Transports", detail:"Voir en transports",
      fin:'<span class="itin-liens">'+
        lien("Google Maps", "google", "transit")+
        lien("Apple Plans", "apple", "transit")+'</span>',
    });
}

/* Une carte de mode interne : le seul endroit où Autour route lui-même. Elle
   est cliquable en entier — c'est un choix, pas une ligne de tableau. */
function carteModeInterne(indice, option){
  return carteMode({
    cle:option.mode, titre:LABEL_MODE[option.mode],
    /* Durée et distance viennent du routage réel, ou de l'estimation à vol
       d'oiseau que le bas du panneau annonce alors comme telle. Rien n'est
       affiché qui ne soit calculé. */
    detail:[option.min+" min", option.m != null ? formatDist(option.m) : null]
      .filter(Boolean).join(" · "),
    action:'data-opt="'+indice+'"',
    fin:'<span class="itin-chevron">'+traitSvg(CHEVRON_ITIN, 19, 2)+'</span>',
  });
}

/* ---- Le mode itinéraire -------------------------------------------------

   Il REMPLACE la fiche, il ne s'y ajoute pas. Tout ce qui sert à découvrir un
   lieu — image, catégorie, prix, description, adresse détaillée, horaires,
   Appeler, Site web, Partager, Favori, Quand, Places, Posté par — disparaît :
   à ce moment-là, la question n'est plus « qu'est-ce que c'est » mais
   « comment j'y vais ».

   La feuille garde ses deux panneaux en mémoire. Basculer ne coûte donc rien
   et « Retour » restitue la fiche telle qu'elle était, défilement compris. */
async function afficherTrajet(l){
  const feuille = $("#feuille");
  const lieu = $("#ficheLieu");
  const panneau = $("#ficheItineraire");
  if(!feuille || !lieu || !panneau) return;
  if(!positionConnue()){ toast("Choisis un point de départ pour calculer le trajet."); return; }

  /* Une réponse OSRM d'une ancienne fiche ne doit jamais repeindre celle qui
     vient d'être ouverte. Un simple numéro de demande suffit : aucun listener,
     minuteur ou état de navigation supplémentaire. */
  const numeroDemande = (afficherTrajet.numeroDemande || 0) + 1;
  afficherTrajet.numeroDemande = numeroDemande;

  const depart = positionMoi;
  const dest = [l.lat, l.lng];
  const dVol = distanceM(depart[0],depart[1],dest[0],dest[1]);
  const droit = (profil)=>({ coords:[depart,dest], reel:false, m:dVol,
    min:tempsTrajetMinutes(dVol, VITESSES_KMH[profil]) });
  const options = [
    {mode:"pied", min:droit("pied").min, m:dVol, segments:[droit("pied")]},
    {mode:"velo", min:droit("velo").min, m:dVol, segments:[droit("velo")]},
  ];

  const adresse = [l.adresse, l.cp].filter(Boolean).join(", ");
  panneau.innerHTML =
    '<div class="itin-tete">'+
      '<button type="button" class="itin-retour" id="btnRetourItin">'+
        traitSvg(FLECHE_RETOUR, 19, 2)+'<span>Retour</span></button>'+
    '</div>'+
    '<h2 class="titre itin-titre">'+esc(l.titre)+'</h2>'+
    (adresse ? '<p class="itin-adresse">'+esc(adresse)+'</p>' : '')+
    '<h3 class="itin-question">Comment y aller ?</h3>'+
    '<div class="itin-modes" id="itinModes"></div>'+
    liensItinerairesExternes(depart, dest)+
    '<p class="itin-note" id="itinNote">'+traitSvg('<circle cx="12" cy="12" r="9"/>'+
      '<path d="M12 16v-4"/><path d="M12 8h.01"/>', 16, 1.8)+
      '<span>Les temps sont donnés à titre indicatif et peuvent varier.</span></p>';

  const peindre = ()=>{
    if(numeroDemande !== afficherTrajet.numeroDemande) return false;
    const zone = $("#itinModes");
    if(!zone) return false;
    zone.innerHTML = options.map((o,i)=>carteModeInterne(i,o)).join("");
    /* Choisir un mode interne, c'est partir : la carte prend l'écran et le
       résumé du trajet remplace tout le reste. La fiche du lieu ne réapparaît
       pas — on est en train de se déplacer. */
    zone.querySelectorAll("[data-opt]").forEach(b=>b.onclick=()=>{
      entrerNav(options[Number(b.dataset.opt)], l.titre);
    });
    return true;
  };
  peindre();

  basculerModeFeuille("itineraire");
  const retour = $("#btnRetourItin");
  if(retour){
    retour.onclick = ()=>{
      basculerModeFeuille("lieu");
      /* Le clavier et le lecteur d'écran doivent suivre la bascule : sans ça,
         le focus reste sur un bouton qui vient de disparaître. */
      const yAller = $("#btnYAller");
      if(yAller) yAller.focus({preventScroll:true});
    };
    retour.focus({preventScroll:true});
  }

  /* Deux requêtes indépendantes seulement. Elles ne touchent ni au classement,
     ni aux données de transport affichées dans Explorer. */
  Promise.all([
    segmentTrajet("pied", depart, dest),
    segmentTrajet("velo", depart, dest),
  ]).then(([pied, velo])=>{
    options[0] = {mode:"pied", min:pied.min, m:pied.m, segments:[pied]};
    options[1] = {mode:"velo", min:velo.min, m:velo.m, segments:[velo]};
    if(!peindre()) return;
    const note = $("#itinNote");
    if(note && !(pied.reel || velo.reel))
      note.textContent = "Routage indisponible : les temps sont estimés à vol d’oiseau.";
  });
}

/* ---- Canal d'un événement ------------------------------------------------
   Annonces visibles par tous ceux qui regardent l'événement, actions
   réservées à son créateur. Rien ici ne ressemble à une conversation. */
async function chargerCanal(l){
  const bloc = $("#canalBloc");
  if(!bloc || !window.AutourEvents) return;
  const canal = await Store.canalDe(l.dbId);
  if(!canal || !document.contains(bloc)) return;
  const messages = await Store.messages(canal.id);
  if(!document.contains(bloc)) return;

  const E = window.AutourEvents;
  const decrits = messages.map(E.decrireMessage);
  const actions = E.actionsPour(canal, moiId);

  bloc.innerHTML =
    (decrits.length
      ? '<p class="fb-section">Mises à jour</p>'+
        decrits.map(m=>'<div class="an-msg'+(m.urgent?' urgent':'')+(m.systeme?' systeme':'')+'">'+
          '<span class="an-tag">'+esc(m.etiquette)+'</span>'+
          '<span class="an-corps">'+esc(m.corps)+'</span></div>').join("")
      : "")+
    (actions.length
      ? '<p class="fb-section">Prévenir les participants</p><div class="an-actions">'+
        actions.map(a=>'<button class="an-act'+(a.danger?' danger':'')+'" data-act="'+a.id+'">'+
          esc(a.label)+'</button>').join("")+'</div>'
      : (canal.admin !== moiId
        ? '<button class="an-suivre" data-suivre="1">Être prévenu des changements</button>' : ""));

  bloc.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>actionCreateur(b.dataset.act, l, canal));
  const suivre = bloc.querySelector("[data-suivre]");
  if(suivre) suivre.onclick=async()=>{
    if(await Store.rejoindre(canal.id, "suiveur")){
      toast("Tu seras prévenu des changements");
      await rafraichirCanaux();
      chargerCanal(l);
    }
  };
}

/* Les six actions. Aucune n'écrit de message système : elles modifient
   l'événement, et la base produit l'annonce — un changement ne peut donc
   pas passer silencieusement. */
async function actionCreateur(id, l, canal){
  const E = window.AutourEvents;
  if(id === "annonce" || id === "retard"){
    const texte = id === "retard"
      ? E.texteRetard(prompt("Retard estimé, en minutes ?"))
      : (prompt("Annonce courte à envoyer aux participants :") || "").trim();
    if(!texte){ if(id === "retard") toast("Retard non compris"); return; }
    toast(await Store.annoncer(canal.id, texte) ? "Annonce envoyée" : "Envoi impossible");
    return chargerCanal(l);
  }
  if(id === "horaire"){
    const saisie = prompt("Nouvel horaire (JJ/MM/AAAA HH:MM) :");
    const quand = saisie && saisie.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if(!quand){ if(saisie) toast("Format attendu : 12/09/2026 20:30"); return; }
    const iso = new Date(+quand[3], +quand[2]-1, +quand[1], +quand[4], +quand[5]).toISOString();
    toast(await Store.modifierEvenement(l.dbId,{debut_le:iso}) ? "Horaire mis à jour" : "Modification impossible");
    return chargerCanal(l);
  }
  if(id === "lieu"){
    const adresse = (prompt("Nouveau lieu :", l.adresse || "") || "").trim();
    if(!adresse) return;
    toast(await Store.modifierEvenement(l.dbId,{adresse}) ? "Lieu mis à jour" : "Modification impossible");
    return chargerCanal(l);
  }
  if(id === "places"){
    const places = parseInt(prompt("Places restantes :"), 10);
    if(!Number.isFinite(places) || places < 0) return;
    toast(await Store.modifierEvenement(l.dbId,{places}) ? "Places mises à jour" : "Modification impossible");
    return chargerCanal(l);
  }
  if(id === "annulation"){
    // Annuler change le cycle de vie ; supprimer reste un geste séparé.
    return annulerPublication(l);
  }
}

/* Partager / Inviter : le partage natif quand il existe, sinon des cibles
   explicites — aucune ne demande de compte. */
async function partagerInviter(l){
  const E = window.AutourEvents;
  const url = lienVers(l);
  const texte = E.texteInvitation(l);
  if(navigator.share){
    try{ await navigator.share({title:l.titre, text:texte, url}); return; }catch(e){ /* replié ci-dessous */ }
  }
  const cibles = E.ciblesPartage(url, texte);
  ouvrirFeuille(
    '<div class="liste-tete"><h2>↗ Partager / Inviter</h2></div>'+
    '<p class="liste-tri">'+esc(texte)+'</p>'+
    '<div class="an-actions">'+cibles.map(c=>
      '<button class="an-act" data-partage="'+c.id+'">'+esc(c.label)+'</button>').join("")+'</div>');
  $("#feuille").querySelectorAll("[data-partage]").forEach(b=>b.onclick=async()=>{
    const cible = cibles.find(c=>c.id === b.dataset.partage);
    if(!cible) return;
    if(cible.href){ open(cible.href, "_blank", "noopener"); return; }
    try{ await navigator.clipboard.writeText(cible.valeur); toast("Lien copié"); }catch(e){}
  });
}

function ouvrirChoixLieu(){
  const libres = lieuxLibres();
  ouvrirFeuille(
    '<h2 class="pub">Où poser ça&nbsp;?</h2>'+
    '<label class="champ"><span>Chercher une adresse</span>'+
      '<input type="text" id="clQ" placeholder="12 rue de la Paix…"></label>'+
    '<div id="clRes"></div>'+
    '<p class="ex-groupe">Lieux libres autour de toi</p>'+
    (libres.length
      ? libres.map(l=>{
          const c = categorieAffichee(l, {emoji:"📍"});
          return '<button class="rang" data-lib="'+esc(l.id)+'">'+
            '<span class="rang-emoji">'+c.emoji+'</span>'+
            '<span class="rang-txt"><span class="rang-nom">'+esc(l.titre)+'</span>'+
            '<span class="rang-sous">'+esc(l.adresse||"")+'</span></span>'+
            '<span class="rang-dist">'+formatDist(l.dist)+'</span></button>';
        }).join("")
      : '<p class="liste-vide">Aucun lieu libre détecté autour.</p>'),
    {kind:"publication", ariaLabel:"Choisir le lieu de la publication"}
  );

  const poser = (nom, lat, lng)=>{
    brouillon.adresse = nom; brouillon.lat = lat; brouillon.lng = lng;
    publicationModifiee = true;
    retourEcran();                       // retour au formulaire, déjà rempli
  };

  $("#feuille").querySelectorAll("[data-lib]").forEach(b=>b.onclick=()=>{
    const l = lieux.find(x=>x.id===b.dataset.lib);
    if(l) poser(l.titre, l.lat, l.lng);
  });

  const champ = $("#clQ");
  let minuteur;
  champ.oninput = ()=>{
    clearTimeout(minuteur);
    const q = champ.value.trim();
    if(q.length < 4){ const z=$("#clRes"); if(z) z.innerHTML=""; return; }
    // on attend une pause de frappe : Nominatim tolère une requête par seconde
    minuteur = setTimeout(async ()=>{
      const res = await chercherAdresse(q);
      const zone = $("#clRes");
      if(!zone) return;
      zone.innerHTML = res.length
        ? res.map((a,i)=>'<button class="rang" data-adr="'+i+'">'+
            '<span class="rang-emoji">📍</span>'+
            '<span class="rang-txt"><span class="rang-sous">'+esc(a.nom)+'</span></span>'+
          '</button>').join("")
        : '<p class="liste-vide">Aucune adresse trouvée.</p>';
      zone.querySelectorAll("[data-adr]").forEach(b=>b.onclick=()=>{
        const a = res[Number(b.dataset.adr)];
        poser(a.nom.split(",").slice(0,2).join(",").trim(), a.lat, a.lng);
      });
    }, 700);
  };
}

function dessinerFormulaire(){
  const b=brouillon;
  const eph=Object.entries(CATS).filter(([,c])=>c.eph);
  const demain = (()=>{ const d=aujourdHui(); d.setDate(d.getDate()+1); return isoDate(d); })();
  const samedi = isoDate(prochainSamedi());

  ouvrirFeuille(
    '<h2 class="pub">Tu poses quoi&nbsp;?</h2>'+

    '<label class="champ"><span>Le truc</span><input type="text" id="fTitre" maxlength="44" placeholder="Pop-up, cypher, collecte…" value="'+esc(b.titre)+'"></label>'+

    // une affiche donne envie de venir bien plus qu'un titre
    '<div class="champ"><span>Une photo ou une affiche <i>(facultatif)</i></span>'+
      '<label class="photo-champ'+(b.imageApercu?' rempli':'')+'">'+
        (b.imageApercu
          ? '<img src="'+esc(b.imageApercu)+'" alt="Aperçu de ton affiche">'
          : '<span class="photo-vide">Choisir une image</span>')+
        '<input type="file" id="fPhoto" accept="image/*">'+
      '</label>'+
      (b.imageApercu ? '<button class="photo-retirer" id="fPhotoX">Retirer</button>' : '')+
    '</div>'+

    '<div class="champ"><span>Où exactement</span>'+
      '<div class="ou"><span class="ou-txt">'+
        '<span class="ou-nom">'+esc(b.adresse||"Point posé sur la carte")+'</span>'+
        '<span class="ou-coord">'+b.lat.toFixed(5)+', '+b.lng.toFixed(5)+'</span>'+
      '</span><button class="ou-bouton" id="fChoisir">Choisir</button>'+
      '<button class="ou-bouton" id="fDeplacer">Carte</button></div>'+
      '<input type="text" id="fAdr" maxlength="52" placeholder="Nom du lieu ou adresse" value="'+esc(b.adresse)+'" style="margin-top:9px">'+
    '</div>'+

    '<div class="champ"><span>Quand</span>'+
      '<div class="raccourcis">'+
        '<button class="chip'+(b.date===isoDate(aujourdHui())?' actif':'')+'" data-jour="'+isoDate(aujourdHui())+'">Aujourd’hui</button>'+
        '<button class="chip'+(b.date===demain?' actif':'')+'" data-jour="'+demain+'">Demain</button>'+
        '<button class="chip'+(b.date===samedi?' actif':'')+'" data-jour="'+samedi+'">Samedi</button>'+
      '</div>'+
      '<div class="duo">'+
        '<label><input type="date" id="fDate" value="'+b.date+'" min="'+isoDate(aujourdHui())+'"></label>'+
        '<label><input type="time" id="fHeure" value="'+b.heure+'" step="900"></label>'+
      '</div>'+
      '<div class="duo" style="margin-top:9px"><label style="flex:0 0 auto;align-self:center;font-size:12.5px;color:var(--ink2)">Jusqu’à</label>'+
        '<label><input type="time" id="fFin" value="'+esc(b.fin)+'" step="900"></label></div>'+
      '<div class="apercu-quand" id="fQuand">'+esc(libelleQuand(b))+'</div>'+
    '</div>'+

    '<div class="champ"><span>Quoi exactement</span><div class="chips">'+
      eph.map(([id,c])=>'<button class="chip '+(b.cat===id?'actif':'')+'" data-cat="'+id+'"><span>'+c.emoji+'</span>'+c.label+'</button>').join("")+
    '</div></div>'+

    '<div class="champ"><span>Entrée</span><div class="bascule">'+
      '<button class="cote '+(b.gratuit?'actif':'')+'" data-gratuit="1">Gratuit</button>'+
      '<button class="cote '+(b.gratuit?'':'actif')+'" data-gratuit="0">Payant</button></div>'+
      (b.gratuit?'':'<div class="ligne"><input type="number" id="fPrix" min="1" max="99" value="'+b.prix+'"><span>€ — encaissés par toi, sur place.</span></div>')+
    '</div>'+

    '<div class="champ"><span>Combien de places</span><div class="bascule">'+
      '<button class="cote '+(b.limite?'':'actif')+'" data-limite="0">Libre</button>'+
      '<button class="cote '+(b.limite?'actif':'')+'" data-limite="1">Limité</button></div>'+
      (b.limite?'<div class="compteur"><button data-pl="-1">−</button><input type="number" id="fPlaces" min="1" max="999" value="'+b.places+'"><button data-pl="1">+</button></div>':'')+
    '</div>'+


    '<button class="valider" id="fOk">Publier</button>'+
    '<button class="annuler-publication" id="fAnnuler">Annuler</button>',
    {kind:"publication", ariaLabel:"Publier un événement"}
  );

  const f=$("#feuille");
  const memo=()=>{
    const avant = JSON.stringify(b);
    b.titre=$("#fTitre").value; b.adresse=$("#fAdr").value;
    b.date=$("#fDate").value; b.heure=$("#fHeure").value; b.fin=$("#fFin").value;
    if($("#fPrix")) b.prix=clamp(Number($("#fPrix").value)||1,1,99);
    if($("#fPlaces")) b.places=clamp(Number($("#fPlaces").value)||1,1,999);
    if(JSON.stringify(b) !== avant) publicationModifiee = true;
  };
  /* La photo est gardée en mémoire (fichier + aperçu local) et n'est envoyée
     qu'à la publication : personne ne doit téléverser une image pour un
     événement qu'il abandonne ensuite. */
  const champPhoto = $("#fPhoto");
  if(champPhoto) champPhoto.onchange = async ()=>{
    const brut = champPhoto.files && champPhoto.files[0];
    if(!brut) return;
    // Une photo d'iPhone est en HEIC et pèse plusieurs mégaoctets : la refuser
    // revenait à interdire l'envoi d'image depuis un téléphone. On la décode,
    // on la redresse, on la réduit et on la réencode en JPEG.
    const fichier = await preparerImage(brut) || brut;
    if(fichier.size > 3 * 1024 * 1024){ toast("Image trop lourde, même après réduction"); return; }
    memo();
    if(b.imageApercu) URL.revokeObjectURL(b.imageApercu);
    b.imageFichier = fichier;
    b.imageApercu = URL.createObjectURL(fichier);
    publicationModifiee = true;
    dessinerFormulaire();
  };
  if($("#fPhotoX")) $("#fPhotoX").onclick = ()=>{
    memo();
    if(b.imageApercu) URL.revokeObjectURL(b.imageApercu);
    b.imageFichier = null; b.imageApercu = "";
    publicationModifiee = true;
    dessinerFormulaire();
  };

  const lier=(sel,fn)=>f.querySelectorAll(sel).forEach(x=>x.onclick=()=>{
    memo(); fn(x); publicationModifiee=true; dessinerFormulaire();
  });
  lier("[data-cat]",    x=>b.cat=x.dataset.cat);
  lier("[data-jour]",   x=>b.date=x.dataset.jour);
  lier("[data-gratuit]",x=>b.gratuit=x.dataset.gratuit==="1");
  lier("[data-limite]", x=>b.limite=x.dataset.limite==="1");
  lier("[data-pl]",     x=>b.places=clamp(b.places+Number(x.dataset.pl),1,999));

  // aperçu du "quand" en direct, sans redessiner tout le formulaire
  ["#fDate","#fHeure","#fFin"].forEach(s=>{
    f.querySelector(s).onchange = ()=>{ memo(); $("#fQuand").textContent = libelleQuand(b); };
  });
  f.querySelector("#fAdr").oninput = ()=>{
    publicationModifiee = true;
    b.adresse = $("#fAdr").value;
    f.querySelector(".ou-nom").textContent = b.adresse || "Point posé sur la carte";
  };
  f.querySelectorAll("input").forEach(input=>input.addEventListener("input",()=>{ publicationModifiee=true; }));

  $("#fChoisir").onclick  = ()=>{ memo(); pousserEcran(ouvrirChoixLieu); };
  $("#fDeplacer").onclick = ()=>{
    memo(); retourFormulaire=true;
    fermerFeuille({preserverPublication:true});
    ouvrirModePose();
  };
  $("#fAnnuler").onclick = ()=>demanderFermetureFeuille();
  $("#fOk").onclick = ()=>{ memo(); publier(); };
}

async function publier(){
  const b=brouillon;
  /* LE COMPTE EST DEMANDÉ ICI, ET SEULEMENT ICI.

     Pas à l'ouverture d'Autour, pas à l'ouverture du formulaire : au moment
     d'appuyer sur Publier, quand la demande a enfin une raison qu'on peut
     écrire — « pour pouvoir modifier ou supprimer cet événement plus tard ».

     Le brouillon n'est pas perdu pendant ce détour : il reste en mémoire, et
     `REPRISES` rappelle `publier()` dès que la session existe. Renvoyer
     quelqu'un à l'accueil avec un formulaire à refaire est le meilleur moyen
     de lui faire abandonner. */
  if(!(await exigerCompte("publier"))) return;
  const identite = await assurerIdentitePublication();
  if(!identite){ toast("Publication annulée"); return; }
  const debut = new Date(b.date+"T"+(b.heure||"00:00")+":00");
  let fin = b.fin ? new Date(b.date+"T"+b.fin+":00") : null;
  if(fin && fin <= debut) fin.setDate(fin.getDate()+1);
  const l=normaliserItem({ id:"n"+Date.now(), cat:b.cat,
    titre:(b.titre||"").trim()||"Sans titre",
    adresse:(b.adresse||"").trim()||"Sur place",
    cp:commune, quand:libelleQuand(b)||"Bientôt",
    gratuit:b.gratuit, prix:b.gratuit?0:b.prix,
    places:b.limite?b.places:null, qr:b.qr, par:identite.name,
    creatorId:identite.id, creatorName:identite.name, mien:true, status:"active",
    lat:b.lat, lng:b.lng,
    debutLe:Number.isFinite(debut.getTime()) ? debut.getTime() : null,
    finLe:fin && Number.isFinite(fin.getTime()) ? fin.getTime() : null,
    // l'aperçu local de l'affiche, le temps que le vrai fichier monte
    image: b.imageFichier ? URL.createObjectURL(b.imageFichier) : "",
    isTemporary:true }, "autour");
  l.envoi = "envoi";

  // 1. à l'écran, maintenant
  epinglerPublication(l.id);
  fusionner([l], "user");
  fermerFeuille();
  filtreActif="tout";
  planifierRendu({carte:true, filtres:true, accueil:true});
  allerVers([l.lat,l.lng], (mc)=>Math.max(mc.getZoom(),17), {duration:.7});
  toast("Publié · visible par tous");

  // 2. le réseau, derrière
  const minuteurRetard = setTimeout(()=>marquerPublication(l.id, "retard"), ATTENTE_VISIBLE_MS);
  publicationsEnVol.set(l.id, b);
  try{
    const image = b.imageFichier ? await Store.televerserImage(b.imageFichier) : "";
    const enligne = await Store.publier(Object.assign({}, l, {image}));
    clearTimeout(minuteurRetard);
    if(!enligne){                            // message déjà affiché par Store
      marquerPublication(l.id, "echec");
      return;
    }
    // l'exemplaire local cède la place à celui que la base a confirmé —
    // l'épingle le suit, sinon l'événement disparaîtrait au moment même où
    // la publication réussit
    userPublications = userPublications.filter(p=>p.id !== l.id);
    publicationsEnVol.delete(l.id);
    publicationsEpinglees.delete(l.id);
    epinglerPublication(enligne.id);
    fusionner([enligne], "user");
    // publier crée le canal côté base : la section Messages apparaît aussitôt
    rafraichirCanaux();
  }catch(e){
    clearTimeout(minuteurRetard);
    console.error("Publication :", e);
    marquerPublication(l.id, "echec");
  }
}

/* Réessayer : le brouillon est encore là, l'affiche aussi. */
async function reessayerPublication(id){
  const l = userPublications.find(x=>x.id === id);
  const b = publicationsEnVol.get(id);
  if(!l || !b) return;
  marquerPublication(id, "envoi");
  const minuteurRetard = setTimeout(()=>marquerPublication(id, "retard"), ATTENTE_VISIBLE_MS);
  try{
    const image = b.imageFichier ? await Store.televerserImage(b.imageFichier) : (l.image || "");
    const enligne = await Store.publier(Object.assign({}, l, {image}));
    clearTimeout(minuteurRetard);
    if(!enligne){ marquerPublication(id, "echec"); return; }
    userPublications = userPublications.filter(p=>p.id !== id);
    publicationsEnVol.delete(id);
    publicationsEpinglees.delete(id);
    epinglerPublication(enligne.id);
    fusionner([enligne], "user");
    rafraichirCanaux();
    toast("Publié · visible par tous");
  }catch(e){
    clearTimeout(minuteurRetard);
    marquerPublication(id, "echec");
  }
}

function ouvrirEcranCompte(action){
  compteEnCours = { action:action || "compte", email:compteEnCours.email || "",
                    typeOtp:"email", envoye:false };
  rendreEcranCompte();
}

function rendreEcranCompte(erreur){
  const inv = COMPTES ? COMPTES.invitation(compteEnCours.action) : {titre:"Ton compte", texte:"", bouton:"Continuer"};
  const e = compteEnCours;
  const message = erreur ? '<p class="cpt-err" role="alert">'+esc(erreur)+'</p>' : "";

  const etape = e.envoye
    ? '<p class="cpt-envoye">Lien envoyé à <strong>'+esc(e.email)+'</strong>.<br>'+
        'Ouvre-le depuis ce téléphone — tu reviendras exactement ici.</p>'+
      '<label class="cpt-lab" for="cptCode">Ou tape le code reçu</label>'+
      '<input class="cpt-champ" id="cptCode" type="text" inputmode="numeric" '+
        'autocomplete="one-time-code" maxlength="6" placeholder="123456">'+
      '<button class="cpt-cta" id="cptValider">Valider</button>'+
      '<button class="cpt-lien" id="cptRenvoyer">Renvoyer le code</button>'+
      '<button class="cpt-lien" id="cptAutre">Changer d’adresse</button>'
    : '<label class="cpt-lab" for="cptEmail">Adresse e-mail</label>'+
      '<input class="cpt-champ" id="cptEmail" type="email" inputmode="email" '+
        'autocomplete="email" placeholder="toi@exemple.fr" value="'+esc(e.email)+'">'+
      '<button class="cpt-cta" id="cptEnvoyer">'+esc(inv.bouton)+'</button>';

  ouvrirFeuille(
    '<section class="cpt" data-testid="ecran-compte" data-action="'+esc(e.action)+'">'+
      '<h2 class="cpt-titre">'+esc(inv.titre)+'</h2>'+
      '<p class="cpt-sous">'+esc(inv.texte)+'</p>'+
      message+etape+
      '<p class="cpt-note">Pas de mot de passe, pas de nom à donner. '+
        'Ton adresse reste privée : elle n’apparaît nulle part sur Autour.</p>'+
    '</section>', {ariaLabel:"Compte Autour"});

  const champ = $("#cptEmail");
  if(champ) champ.oninput = ()=>{ compteEnCours.email = champ.value; };

  const envoyer = $("#cptEnvoyer");
  if(envoyer) envoyer.onclick = async()=>{
    envoyer.disabled = true;
    envoyer.textContent = "Envoi…";
    const r = await envoyerLienCompte(compteEnCours.email);
    if(!r.ok){ rendreEcranCompte(r.message); return; }
    compteEnCours.envoye = true;
    compteEnCours.typeOtp = r.typeOtp;
    /* Le compteur du renvoi démarre AU PREMIER envoi, pas seulement aux
       suivants : le serveur, lui, compte déjà cette minute. */
    renvoiCompteAvant = Date.now() + RENVOI_COMPTE_MS;
    rendreEcranCompte();
  };

  /* Le renvoi partage tout avec l'envoi — même fonction, même manœuvre, même
     type de jeton — et n'existe que pour régénérer un OTP frais. Il est bloqué
     tant que la minute n'est pas écoulée, et le décompte le dit. */
  const renvoyer = $("#cptRenvoyer");
  if(renvoyer){
    const rythmerRenvoi = ()=>{
      if(renvoiCompteMinuteur){ clearInterval(renvoiCompteMinuteur); renvoiCompteMinuteur = null; }
      const tic = ()=>{
        const reste = Math.ceil((renvoiCompteAvant - Date.now())/1000);
        if(reste > 0){
          renvoyer.disabled = true;
          renvoyer.textContent = "Renvoyer dans "+reste+" s";
        }else{
          renvoyer.disabled = false;
          renvoyer.textContent = "Renvoyer le code";
          if(renvoiCompteMinuteur){ clearInterval(renvoiCompteMinuteur); renvoiCompteMinuteur = null; }
        }
      };
      tic();
      if(renvoiCompteAvant > Date.now()) renvoiCompteMinuteur = setInterval(tic, 1000);
    };
    rythmerRenvoi();
    renvoyer.onclick = async()=>{
      if(Date.now() < renvoiCompteAvant) return;      // la garde, pas seulement l'apparence
      renvoyer.disabled = true;
      renvoyer.textContent = "Envoi…";
      const r = await envoyerLienCompte(compteEnCours.email);
      if(!r.ok){ rendreEcranCompte(r.message); return; }
      compteEnCours.typeOtp = r.typeOtp;              // le type suit la manœuvre, comme au premier envoi
      renvoiCompteAvant = Date.now() + RENVOI_COMPTE_MS;
      toast("Nouveau code envoyé à "+compteEnCours.email);
      rendreEcranCompte();
    };
  }

  const valider = $("#cptValider");
  if(valider) valider.onclick = async()=>{
    const code = ($("#cptCode") || {}).value || "";
    valider.disabled = true;
    const r = await verifierCodeCompte(compteEnCours.email, code, compteEnCours.typeOtp);
    if(!r.ok){ rendreEcranCompte(r.message); return; }
    fermerFeuille();
    await chargerProfil();
    await chargerFavoris();
    rafraichirCanaux();
    /* La reprise est branchée sur `onAuthStateChange` : elle a donc déjà lieu
       pour le lien reçu par e-mail comme pour le code tapé ici. On ne la
       rejoue pas une seconde fois — ce serait publier deux fois. */
  };

  const autre = $("#cptAutre");
  if(autre) autre.onclick = ()=>{
    /* On change d'adresse : le décompte de l'ancienne n'a plus de sens, et son
       minuteur ne doit pas continuer à battre sur un bouton disparu. */
    if(renvoiCompteMinuteur){ clearInterval(renvoiCompteMinuteur); renvoiCompteMinuteur = null; }
    renvoiCompteAvant = 0;
    compteEnCours.envoye = false;
    rendreEcranCompte();
  };
}

/* Sans compte, cet écran ne dit pas « connectez-vous » : il montre ce qu'un
   compte apporterait. C'est la même règle que partout ailleurs — la valeur
   d'abord, la demande ensuite. */
async function ouvrirProfil(){
  if(!estConnecte()){
    ouvrirFeuille(
      '<section class="cpt" data-testid="profil-visiteur">'+
        '<h2 class="cpt-titre">Ton compte</h2>'+
        '<p class="cpt-sous">Tu peux explorer, chercher et demander de l’aide '+
          'sans compte. Un compte sert à garder ce qui t’appartient&nbsp;:</p>'+
        '<ul class="cpt-liste">'+
          '<li>📍 publier un événement, et le modifier ensuite</li>'+
          '<li>♡ retrouver tes favoris sur n’importe quel téléphone</li>'+
          '<li>🔔 être prévenu des annonces des événements que tu suis</li>'+
        '</ul>'+
        '<button class="cpt-cta" id="profilConnexion">Continuer avec mon e-mail</button>'+
      '</section>', {ariaLabel:"Profil"});
    const b = $("#profilConnexion");
    if(b) b.onclick = ()=>ouvrirEcranCompte("compte");
    return;
  }

  if(!monProfil) await chargerProfil();
  const pseudo = (monProfil && monProfil.display_name) || "";
  const notifs = !monProfil || monProfil.notifications !== false;

  ouvrirFeuille(
    '<section class="cpt" data-testid="profil">'+
      '<h2 class="cpt-titre">Profil</h2>'+

      '<label class="cpt-lab" for="profPseudo">Pseudo <i>facultatif, public</i></label>'+
      '<input class="cpt-champ" id="profPseudo" type="text" maxlength="30" '+
        'placeholder="Comme tu veux qu’on t’appelle" value="'+esc(pseudo)+'">'+
      '<button class="cpt-lien" id="profPseudoOk">Enregistrer le pseudo</button>'+

      /* L'adresse s'affiche ici, sur son propre écran, et nulle part ailleurs :
         ni sur une publication, ni dans un canal, ni dans une liste. */
      '<p class="cpt-lab">Adresse e-mail <i>privée</i></p>'+
      '<p class="cpt-valeur" data-testid="profil-email">'+esc(monEmail())+'</p>'+

      '<div class="cpt-actions">'+
        '<button class="ac-item" data-profil="publications">'+
          '<span class="ac-emoji">📍</span><span class="ac-txt">'+
          '<span class="ac-nom">Mes publications</span></span></button>'+
        '<button class="ac-item" data-profil="favoris">'+
          '<span class="ac-emoji">♡</span><span class="ac-txt">'+
          '<span class="ac-nom">Mes favoris</span></span></button>'+
        '<button class="ac-item" data-profil="evenements">'+
          '<span class="ac-emoji">📣</span><span class="ac-txt">'+
          '<span class="ac-nom">Mes événements</span></span></button>'+
      '</div>'+

      '<label class="cpt-bascule">'+
        '<input type="checkbox" id="profNotifs"'+(notifs?" checked":"")+'>'+
        '<span>Notifications&nbsp;— être prévenu des annonces</span>'+
      '</label>'+

      '<button class="cpt-lien cpt-sortie" id="profDeconnexion">Se déconnecter</button>'+
    '</section>', {ariaLabel:"Profil"});

  const ok = $("#profPseudoOk");
  if(ok) ok.onclick = async()=>{
    const v = String(($("#profPseudo")||{}).value || "").trim().slice(0,30);
    const enregistre = await enregistrerProfilCompte({display_name: v || null});
    toast(enregistre ? "Pseudo enregistré" : "Pseudo non enregistré");
    if(enregistre) reconstruireLieux();
  };

  const bascule = $("#profNotifs");
  if(bascule) bascule.onchange = async()=>{
    const ok2 = await enregistrerProfilCompte({notifications: !!bascule.checked});
    if(!ok2){ bascule.checked = !bascule.checked; toast("Préférence non enregistrée"); }
  };

  $("#feuille").querySelectorAll("[data-profil]").forEach(b=>b.onclick=()=>{
    const quoi = b.dataset.profil;
    if(quoi === "favoris") return ouvrirFavoris();
    if(quoi === "evenements") return ouvrirCanaux();
    return ouvrirMesPublications();
  });

  const sortie = $("#profDeconnexion");
  if(sortie) sortie.onclick = async()=>{ await seDeconnecter(); ouvrirProfil(); };
}

/* Mes publications : la clause de propriété est écrite en base (`created_by =
   auth.uid()`), pas ici. Le client demande « les miennes » et le serveur
   décide ce que ça veut dire — c'est la seule façon que ça reste vrai. */
async function ouvrirMesPublications(){
  if(!(await exigerCompte("mes-publications"))) return;
  let lignes = [];
  if(sb){
    const { data, error } = await sb.rpc("mes_publications");
    if(error) console.error("Mes publications :", error.message);
    lignes = data || [];
  }
  const corps = lignes.length
    ? lignes.map(p=>{
        const c = categorieAffichee(p, {emoji:"📍"});
        return '<button class="ac-item" data-mienne="'+esc(p.id)+'">'+
          '<span class="ac-emoji">'+c.emoji+'</span>'+
          '<span class="ac-txt"><span class="ac-nom">'+esc(p.titre || "Sans titre")+
            (p.status === "cancelled" ? ' <i class="ferme">annulé</i>' : '')+'</span>'+
          '<span class="ac-sous">'+esc(p.adresse || "")+'</span></span></button>';
      }).join("")
    : '<p class="liste-vide">Tu n’as rien publié pour l’instant.</p>';

  ouvrirFeuille(
    '<div class="liste-tete"><h2>📍 Mes publications</h2>'+
    '<span class="liste-compte">'+lignes.length+'</span></div>'+corps,
    {ariaLabel:"Mes publications"});

  $("#feuille").querySelectorAll("[data-mienne]").forEach(b=>b.onclick=()=>{
    const l = lieux.find(x=>x.dbId === b.dataset.mienne);
    if(l){ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(l.id)); }
    else toast("Cet événement n\u2019est plus chargé sur la carte");
  });
}

/* La liste des canaux : un par événement qui me concerne, et rien d'autre. */
function ouvrirCanaux(){
  const E = window.AutourEvents;
  const actifs = E ? E.canauxActifs(canauxAMoi) : [];
  const corps = actifs.length
    ? actifs.map(c=>{
        const attente = Number(c.non_lus) || 0;
        return '<button class="ac-item" data-canal="'+esc(c.publication_id)+'">'+
          '<span class="ac-emoji">'+(c.role === "admin" ? "📣" : "👥")+'</span>'+
          '<span class="ac-txt"><span class="ac-nom">'+esc(c.titre)+
            (c.annule ? ' <i class="ferme">annulé</i>' : '')+'</span>'+
          '<span class="ac-sous">'+esc(c.dernier_message || "Aucune annonce")+'</span></span>'+
          (attente ? '<span class="ac-dist">'+attente+'</span>' : '')+'</button>';
      }).join("")
    : '<p class="liste-vide">Aucun événement en cours.</p>';
  ouvrirFeuille(
    '<div class="liste-tete"><h2>📣 Mes événements</h2>'+
    '<span class="liste-compte">'+actifs.length+'</span></div>'+
    '<p class="liste-tri">Les événements que tu as créés, rejoints ou enregistrés. '+
      'Autour n\u2019a pas de messagerie : seulement ces canaux-là.</p>'+corps);

  $("#feuille").querySelectorAll("[data-canal]").forEach(b=>b.onclick=()=>{
    const l = lieux.find(x=>x.dbId === b.dataset.canal);
    if(l){ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(l.id)); }
    else toast("Cet événement n\u2019est plus chargé sur la carte");
  });
}

(function(root){
  "use strict";

  /* Registre produit des zones autonomes. `territories` reste le registre
     technique des sources et des territoires de service ; ce registre-ci est
     l'identité stable que le client met dans chaque donnée, chaque cache et
     chaque contexte de session. */
  const DEFINITIONS = [
    {id:"mel", label:"Métropole lilloise", city:"Lille", lat:50.6292, lng:3.0573, radiusM:35000, timezone:"Europe/Paris"},
    {id:"paris", label:"Paris", city:"Paris", lat:48.8566, lng:2.3522, radiusM:32000, timezone:"Europe/Paris"},
    {id:"angers", label:"Angers", city:"Angers", lat:47.4784, lng:-0.5632, radiusM:26000, timezone:"Europe/Paris"},
    {id:"rennes", label:"Rennes", city:"Rennes", lat:48.1173, lng:-1.6778, radiusM:26000, timezone:"Europe/Paris"},
    {id:"rouen", label:"Rouen", city:"Rouen", lat:49.4432, lng:1.0993, radiusM:26000, timezone:"Europe/Paris"},
  ].map((zone)=>Object.freeze(Object.assign({}, zone)));
  const PAR_ID = new Map(DEFINITIONS.map((zone)=>[zone.id, zone]));
  const TERRE_M = 6371000;

  function nombre(value){ return typeof value === "number" && Number.isFinite(value); }
  function coordonnees(value){
    if(Array.isArray(value) && nombre(value[0]) && nombre(value[1])) return [value[0], value[1]];
    if(value && nombre(Number(value.lat)) && nombre(Number(value.lng))) return [Number(value.lat), Number(value.lng)];
    if(value && nombre(Number(value.latitude)) && nombre(Number(value.longitude))) return [Number(value.latitude), Number(value.longitude)];
    return null;
  }
  function distanceM(aLat,aLng,bLat,bLng){
    const r = Math.PI / 180;
    const dLat = (bLat-aLat)*r, dLng = (bLng-aLng)*r;
    const s = Math.sin(dLat/2)**2 + Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin(dLng/2)**2;
    return 2*TERRE_M*Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function normaliserId(value){
    const id = String(value == null ? "" : value).trim().toLowerCase();
    if(!id) return null;
    if(id === "lille" || id === "metropole-lilloise" || id === "metropole_lilloise") return "mel";
    return PAR_ID.has(id) ? id : null;
  }
  function definition(value){
    const id = normaliserId(value);
    return id ? PAR_ID.get(id) : null;
  }
  function zoneIdForPoint(value){
    const point = coordonnees(value);
    if(!point) return null;
    return DEFINITIONS
      .map((zone)=>({zone, distance:distanceM(point[0],point[1],zone.lat,zone.lng)}))
      .filter((entry)=>entry.distance <= entry.zone.radiusM)
      .sort((a,b)=>a.distance-b.distance)[0]?.zone.id || null;
  }
  function zoneIdForItem(item){
    const explicite = normaliserId(item && (item.zone_id || item.zoneId || item.active_zone_id));
    return explicite || zoneIdForPoint(item);
  }
  function zoneIdForContext(context){
    if(!context) return null;
    return normaliserId(context.zone_id || context.zoneId) || zoneIdForPoint(context);
  }
  function label(value){ return definition(value)?.label || String(value || ""); }
  function annoter(item, fallbackPoint){
    const zoneId = zoneIdForItem(item) || zoneIdForPoint(fallbackPoint);
    return zoneId ? Object.assign({}, item, {zone_id:zoneId, zoneId}) : Object.assign({}, item);
  }

  root.AutourZones = Object.freeze({
    DEFINITIONS:Object.freeze(DEFINITIONS),
    ids:Object.freeze(DEFINITIONS.map((zone)=>zone.id)),
    definition,
    label,
    normaliserId,
    coordonnees,
    distanceM,
    zoneIdForPoint,
    zoneIdForItem,
    zoneIdForContext,
    annoter,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);

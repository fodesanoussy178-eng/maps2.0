# Passe du 29 août 2026 — alimentation métropolitaine

Dix-huit migrations ont été appliquées à la production ce jour-là. Elles sont
enregistrées dans `supabase_migrations.schema_migrations` du projet
`sxnzyvcgwbwnpjnqmpkp`, qui en porte le SQL exact.

Les dix-huit fichiers `.sql` sont maintenant dans ce dossier. Ils n'ont pas été
retranscrits à la main : chacun a été tiré de la base, puis vérifié octet par
octet contre le registre de production — l'empreinte MD5 du fichier, moins son
saut de ligne final, égale `md5(array_to_string(statements, E'\n'))` de la
ligne correspondante. Dix-huit sur dix-huit, zéro écart. C'est ce qui permet de
les rejouer sans craindre qu'une faute de frappe atteigne la production.

Pour revérifier :

```
printf %s "$(cat 20260829124906_evenements_du_bassin.sql)" | md5sum
```

Ce fichier dit ce que chaque migration fait, et pourquoi elle existe.

| version | nom | ce qu'elle fait |
|---|---|---|
| 20260829080142 | `event_areas_mel_communes` | `commune_keys` sur les zones ; la liste des communes décide, le rectangle n'interroge que |
| 20260829080753 | `mel_communes_reference` | les 95 communes de l'EPCI 200093201 + les communes associées ; `commune_cle()` |
| 20260829080936 | `importance_major_stricte` | `lieux_majeurs`, `evenements_majeurs`, `evenement_est_majeur()` — « majeur » exige une raison nommable |
| 20260829081022 | `majeur_titre_et_artefacts` | le motif de titre doit ouvrir le titre ; `titre_non_evenement()` |
| 20260829081102 | `titre_non_evenement_precis` | deux régimes : mot seul vs tournure de page — « Programme Seniors » n'est pas une page |
| 20260829081131 | `events_commune_et_plafond_majeur` | colonne `events.commune` ; le déclencheur normalise la ville et plafonne « majeur » |
| 20260829081329 … 081512 | `rapprocher_doublons` (×4) | noyau de titre + jour + 200 m + heure ; sans cycle ; inclusion de titres |
| 20260829122735 | `invoke_datatourisme_sync` | déclencher DATAtourisme depuis la base, avec le secret du Vault |
| 20260829122923 | `decouverte_openagenda` | `openagenda_candidats`, `openagenda_sonder()`, `openagenda_recolter()` |
| 20260829123317 | `mel_quatre_couronnes` | cinq rectangles qui couvrent les 95 communes une fois chacune |
| 20260829123512 | `openagenda_mel_inventaire` | 26 territoires MEL et 44 sources OpenAgenda actives |
| 20260829123621 | `invoke_openagenda_source` | synchroniser UNE source désignée, pas la première du territoire |
| 20260829123954 | `interets_tags_reference` | miroir SQL de `INTEREST_MATCHING`, pour auditer la couverture par envie |
| 20260829124906 | `evenements_du_bassin` | `evenements_bassin()` : le bassin entier, sans plafond de distance |
| 20260829125013 | `profiles_pourtoi_consulte` | `profiles.pourtoi_consulte_le`, pour la pastille rouge |

`evenements_proches` n'a pas été touchée : c'est elle qui sert « Maintenant »,
et son comportement hyper-local est voulu.

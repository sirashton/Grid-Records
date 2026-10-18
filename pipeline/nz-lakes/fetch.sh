#!/usr/bin/env bash
# Downloads the inputs for build.mjs: the Electricity Authority's Hydrological
# Modelling Dataset and hourly ERA5 sunshine and wind from Open-Meteo.
#   pipeline/nz-lakes/fetch.sh .cache-nz-lakes
set -euo pipefail
OUT=${1:-.cache-nz-lakes}
mkdir -p "$OUT/hmd" "$OUT/weather"
BASE=https://emidatasets.blob.core.windows.net/publicdata
curl -sS "$BASE?restype=container&comp=list&prefix=Datasets/Environment/HydrologicalModellingDataset/&maxresults=5000" \
  | grep -o '<Name>[^<]*</Name>' | sed 's/<\/\?Name>//g' | grep -i '\.csv$' > $OUT/hmd/files.txt
wc -l $OUT/hmd/files.txt
while read -r f; do
  dest="$OUT/hmd/$(echo "$f" | sed 's#Datasets/Environment/HydrologicalModellingDataset/##')"
  mkdir -p "$(dirname "$dest")"
  curl -sS --fail -o "$dest" "$BASE/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$f")" || echo "FAILED $f"
done < $OUT/hmd/files.txt
du -sh $OUT/hmd
# Weather: hourly ERA5 from Open-Meteo, 1980 to 2024, in decade chunks.
SITES="solar_canterbury:-43.60:172.00 solar_waikato:-37.80:175.30 solar_hawkesbay:-39.60:176.80 solar_marlborough:-41.50:173.90 solar_northland:-35.70:174.30 solar_otago:-45.00:169.40 wind_tararua:-40.35:175.80 wind_wellington:-41.28:174.68 wind_southland:-45.70:168.20 wind_waikato:-37.85:174.85 wind_hawkesbay:-39.30:176.60 wind_taranaki:-39.75:174.40 wind_otago:-45.80:169.95"
for s in $SITES; do
  IFS=: read -r name lat lon <<< "$s"
  var=shortwave_radiation; [[ $name == wind_* ]] && var=wind_speed_100m
  for y in 1980 1990 2000 2010 2020; do
    e=$((y+9)); [ $e -gt 2025 ] && e=2025
    out="$OUT/weather/${name}_${y}.json"
    for i in 1 2 3 4; do
      if curl -sS --fail -o "$out" "https://archive-api.open-meteo.com/v1/archive?latitude=$lat&longitude=$lon&start_date=$y-01-01&end_date=$e-12-31&hourly=$var&timezone=GMT"; then break; fi
      sleep $((i*20))
    done
    sleep 3
  done
done
du -sh $OUT/weather; ls $OUT/weather | head

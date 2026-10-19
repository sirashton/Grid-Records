set +e
mkdir -p out; cd out
UA="grid-records (+https://github.com/sirashton/Grid-Records)"
get() { curl -sSL -A "$UA" -m 900 -o "$2" -w "$1 %{http_code} %{size_download} %{time_total}s\n" "$1" | tee -a urls.txt; }
B=https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM
dl() { # month table
  M=$1; T=$2; Y=${M%_*}; H="d-$M.html"
  [ -f $H ] || get "$B/$Y/MMSDM_$M/MMSDM_Historical_Data_SQLLoader/DATA/" $H
  L=$(grep -oiE 'href="[^"]*(%23|_DVD_)'"$T"'(%23|_[0-9]{6})[^"]*\.zip"' $H | head -1 | sed -E 's/^href="//I;s/"$//')
  [ -z "$L" ] && { echo "$M $T none" >> urls.txt; return; }
  get "https://nemweb.com.au$L" z.zip
  rm -rf x; unzip -o -q z.zip -d x
  for f in $(find x -type f); do echo "== $M $T $f $(stat -c%s $f) bytes $(wc -l <$f) lines" >> heads.txt; head -c 2500 "$f" >> heads.txt; echo >> heads.txt; echo ... >> heads.txt; tail -c 300 "$f" >> heads.txt; echo >> heads.txt; done
  case $T in GENUNITS|DUALLOC|DUDETAILSUMMARY|MARKET_PRICE_THRESHOLDS) find x -type f -exec cp {} "keep-$M-$T.csv" \; ;; esac
  if [ $T = DISPATCH_UNIT_SCADA ]; then find x -type f -exec awk -F, '$1=="D"{d=$6;v=$7+0;n[d]++;s[d]+=v;if(!(d in mx)||v>mx[d])mx[d]=v;if(!(d in mn)||v<mn[d])mn[d]=v; if(v<0)neg[d]++} END{for(d in n) printf "%s,%d,%.1f,%.1f,%.1f,%d\n",d,n[d],s[d]/n[d],mn[d],mx[d],neg[d]}' {} \; | sort > "duid-$M.csv"; fi
  rm -rf x z.zip
}
for T in GENUNITS DISPATCH_UNIT_SCADA; do dl 2026_08 $T; done
for T in DISPATCH_UNIT_SCADA ROOFTOP_PV_ACTUAL GENUNITS; do dl 2015_01 $T; done
cd ..
git config user.name ci; git config user.email ci@users.noreply.github.com
git checkout -b probe-au-out; git add out; git commit -qm probe; git push -qf "https://x-access-token:$GH_TOKEN@github.com/${GITHUB_REPOSITORY}" probe-au-out

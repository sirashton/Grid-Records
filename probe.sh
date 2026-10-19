set +e
mkdir -p out; cd out
UA="grid-records (+https://github.com/sirashton/Grid-Records)"
get() { curl -sSL -A "$UA" -m 900 -o "$2" -w "$1 %{http_code} %{size_download} %{time_total}s\n" "$1" | tee -a urls.txt; }
B=https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM
for Y in 2009 2012 2017 2021; do get $B/$Y/ y$Y.html; done
for d in MMSDM_2012_06/ MMSDM_2012_06/MMSDM_Historical_Data_SQLLoader/ MMSDM_2012_06/MMSDM_Historical_Data_SQLLoader/DATA/ MMSDM_2017_06/MMSDM_Historical_Data_SQLLoader/DATA/ MMSDM_2021_06/MMSDM_Historical_Data_SQLLoader/DATA/; do Y=${d:6:4}; get $B/$Y/$d "l-$(echo $d|tr / _).html"; done
dl() { # month table
  M=$1; T=$2; Y=${M%_*}; H="d-$M.html"
  [ -f $H ] || get "$B/$Y/MMSDM_$M/MMSDM_Historical_Data_SQLLoader/DATA/" $H
  L=$(grep -oiE 'href="[^"]*[#_]'"$T"'[#_][^"]*\.zip"' $H | head -1 | sed -E 's/^href="//I;s/"$//;s/#/%23/g')
  [ -z "$L" ] && { echo "$M $T none" >> urls.txt; return; }
  get "https://nemweb.com.au$L" z.zip
  rm -rf x; unzip -o -q z.zip -d x
  for f in $(find x -type f); do echo "== $M $T $f $(stat -c%s $f) bytes $(wc -l <$f) lines" >> heads.txt; head -c 2500 "$f" >> heads.txt; echo >> heads.txt; echo ... >> heads.txt; tail -c 300 "$f" >> heads.txt; echo >> heads.txt; done
  case $T in GENUNITS|DUALLOC|DUDETAILSUMMARY|MARKET_PRICE_THRESHOLDS) find x -type f -exec cp {} "keep-$M-$T.csv" \; ;; esac
  rm -rf x z.zip
}
for T in DISPATCH_UNIT_SCADA GENUNITS DUALLOC DUDETAILSUMMARY ROOFTOP_PV_ACTUAL TRADINGPRICE DISPATCHREGIONSUM MARKET_PRICE_THRESHOLDS; do dl 2026_08 $T; done
for T in DISPATCH_UNIT_SCADA ROOFTOP_PV_ACTUAL TRADINGPRICE; do dl 2017_06 $T; done
for T in DISPATCH_UNIT_SCADA TRADINGPRICE; do dl 2012_06 $T; dl 2009_07 $T; done
cd ..
git config user.name ci; git config user.email ci@users.noreply.github.com
git checkout -b probe-au-out; git add out; git commit -qm probe; git push -qf "https://x-access-token:$GH_TOKEN@github.com/${GITHUB_REPOSITORY}" probe-au-out

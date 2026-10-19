set +e
mkdir -p out; cd out
UA="grid-records (+https://github.com/sirashton/Grid-Records)"
get() { curl -sSL -A "$UA" -m 600 -o "$2" -w "$1 %{http_code} %{size_download} %{time_total}s\n" "$1" | tee -a urls.txt; }
B=https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM
get $B/ mmsdm.html
get $B/2026/ mmsdm2026.html
for M in 2026_08 2012_06; do
  Y=${M%_*}
  get "$B/$Y/MMSDM_$M/MMSDM_Historical_Data_SQLLoader/DATA/" "data_$M.html"
  for T in DISPATCH_UNIT_SCADA GENUNITS DUALLOC DUDETAILSUMMARY ROOFTOP_PV_ACTUAL TRADINGPRICE DISPATCHREGIONSUM; do
    L=$(grep -oiE 'href="[^"]*'"$T"'[^"]*\.zip"' "data_$M.html" | head -1 | sed -E 's/href="//;s/"$//')
    [ -z "$L" ] && { echo "$M $T none" >> urls.txt; continue; }
    case "$L" in http*) U=$L;; /*) U="https://nemweb.com.au$L";; *) U="$B/$Y/MMSDM_$M/MMSDM_Historical_Data_SQLLoader/DATA/$L";; esac
    get "$U" "$M-$T.zip"
    unzip -o -q "$M-$T.zip" -d "x-$M-$T"
    for f in $(find "x-$M-$T" -type f); do echo "== $f $(stat -c%s $f) $(wc -l <$f) lines" >> heads.txt; head -c 3000 "$f" >> heads.txt; echo >> heads.txt; tail -c 400 "$f" >> heads.txt; echo >> heads.txt; done
    if [ "$T" = GENUNITS ] || [ "$T" = DUALLOC ] || [ "$T" = DUDETAILSUMMARY ]; then find "x-$M-$T" -type f -exec cp {} "keep-$M-$T.csv" \; ; fi
    rm -rf "x-$M-$T" "$M-$T.zip"
  done
done
R=https://nemweb.com.au/Reports/Current
for p in Dispatch_SCADA ROOFTOP_PV/ACTUAL Next_Day_Actual_Gen TradingIS_Reports Daily_Reports; do get "$R/$p/" "cur-$(echo $p|tr / _).html"; done
get https://nemweb.com.au/Reports/Archive/Dispatch_SCADA/ arch-scada.html
get https://nemweb.com.au/Reports/Archive/ROOFTOP_PV/ACTUAL/ arch-rooftop.html
get https://data.opennem.org.au/v3/stats/au/NEM/power/7d.json oe7d.json
get https://api.openelectricity.org.au/v4/ oe.json
cd ..
git config user.name ci; git config user.email ci@users.noreply.github.com
git checkout -b probe-au-out; git add out; git commit -qm probe; git push -qf "https://x-access-token:$GH_TOKEN@github.com/${GITHUB_REPOSITORY}" probe-au-out

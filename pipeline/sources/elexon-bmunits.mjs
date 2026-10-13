// Identifies battery BM units from Elexon's BM unit register. Elexon has no
// battery fuel type, so batteries are recognised by name, plus National Grid's
// naming convention (a "B" before the unit number, e.g. BLWNB-1) where the
// unit can both import and export.
import { fetchJson, log } from '../lib.mjs';

const URL = 'https://data.elexon.co.uk/bmrs/api/v1/reference/bmunits/all';

const NAME = /batt|bess|energy storage|battery storage|\bstorage\b/i;
const NOT_BATTERY = /pumped|hydro|\bgas\b|ccgt/i;
// Greener grid parks (synchronous compensators and flywheels), not batteries.
const EXCLUDE = new Set(['KTHRS-1', 'KTHRS-2', 'LRDSC-1', 'LRDSC-2']);
const NG_BATTERY_ID = /^[A-Z0-9]{4}B-\d+$/;

export function classifyBatteries(units) {
  const out = [];
  for (const u of units) {
    const ng = u.nationalGridBmUnit ?? '';
    const name = u.bmUnitName ?? '';
    if (EXCLUDE.has(ng) || NOT_BATTERY.test(name) || u.fuelType === 'PS') continue;
    if (u.fuelType && !['OTHER'].includes(u.fuelType)) continue;
    const gen = Math.abs(Number.parseFloat(u.generationCapacity) || 0);
    const dem = Math.abs(Number.parseFloat(u.demandCapacity) || 0);
    let reason = null;
    if (NAME.test(name)) reason = 'name';
    else if (NG_BATTERY_ID.test(ng) && gen > 0 && dem > 0 && Math.min(gen, dem) / Math.max(gen, dem) > 0.5) reason = 'id';
    if (reason) {
      out.push({
        elexon: u.elexonBmUnit,
        ng: u.nationalGridBmUnit,
        name: name.trim(),
        party: u.leadPartyName,
        mw: gen,
        reason,
      });
    }
  }
  return out.sort((a, b) => (a.ng ?? '').localeCompare(b.ng ?? ''));
}

export async function fetchBatteryUnits() {
  const units = await fetchJson(URL);
  const list = Array.isArray(units) ? units : units?.data ?? [];
  const batteries = classifyBatteries(list);
  const mw = batteries.reduce((n, b) => n + b.mw, 0);
  log(`Elexon BM units: ${list.length} units, ${batteries.length} batteries (${Math.round(mw)} MW)`,
    `[${batteries.filter((b) => b.reason === 'name').length} by name, ${batteries.filter((b) => b.reason === 'id').length} by id]`);
  return batteries;
}

// Every country with a page, in the order of the country switch. Paths are
// from the site root; `nav` is the switch label when it differs from the
// config's name. The switch at the top of every page is stamped from this
// list by pipeline/nav.mjs (npm run nav), so a country added here shows up
// on every page with no other change.

import gb from './gb.js';
import nz from './nz.js';
import de from './de.js';
import au from './au.js';
import pl from './pl.js';
import br from './br.js';
import fr from './fr.js';
import wa from './wa.js';
import cz from './cz.js';
import jp from './jp.js';
import bg from './bg.js';
import dk from './dk.js';
import gr from './gr.js';
import tx from './tx.js';

export const COUNTRIES = [
  { country: gb, page: '', data: 'data', flag: 'flags/gb.svg' },
  { country: nz, page: 'nz/', data: 'data/nz', flag: 'flags/nz.svg' },
  { country: de, page: 'de/', data: 'data/de', flag: 'flags/de.svg' },
  { country: au, page: 'au/', data: 'data/au/nem', flag: 'flags/au.svg', nav: 'Australia' },
  { country: pl, page: 'pl/', data: 'data/pl', flag: 'flags/pl.svg' },
  { country: br, page: 'br/', data: 'data/br', flag: 'flags/br.svg' },
  { country: fr, page: 'fr/', data: 'data/fr', flag: 'flags/fr.svg' },
  { country: wa, page: 'wa/', data: 'data/wa', flag: 'flags/wa.svg' },
  { country: cz, page: 'cz/', data: 'data/cz', flag: 'flags/cz.svg' },
  { country: jp, page: 'jp/', data: 'data/jp', flag: 'flags/jp.svg', nav: 'Japan' },
  { country: bg, page: 'bg/', data: 'data/bg', flag: 'flags/bg.svg' },
  { country: dk, page: 'dk/', data: 'data/dk', flag: 'flags/dk.svg' },
  { country: gr, page: 'gr/', data: 'data/gr', flag: 'flags/gr.svg' },
  { country: tx, page: 'tx/', data: 'data/tx', flag: 'flags/tx.svg', nav: 'Texas' },
];

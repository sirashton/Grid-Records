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
import gr from './gr.js';

export const COUNTRIES = [
  { country: gb, page: '', data: 'data', flag: 'flags/gb.svg' },
  { country: nz, page: 'nz/', data: 'data/nz', flag: 'flags/nz.svg' },
  { country: de, page: 'de/', data: 'data/de', flag: 'flags/de.svg' },
  { country: au, page: 'au/', data: 'data/au/nem', flag: 'flags/au.svg', nav: 'Australia' },
  { country: pl, page: 'pl/', data: 'data/pl', flag: 'flags/pl.svg' },
  { country: br, page: 'br/', data: 'data/br', flag: 'flags/br.svg' },
  { country: fr, page: 'fr/', data: 'data/fr', flag: 'flags/fr.svg' },
  { country: wa, page: 'wa/', data: 'data/wa', flag: 'flags/wa.svg' },
  { country: gr, page: 'gr/', data: 'data/gr', flag: 'flags/gr.svg' },
];

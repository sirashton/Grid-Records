// Every country with a page, in the order of the country switch. Paths are
// from the site root. The Live records page reads this list, so a country
// added here shows up there with no other change.

import gb from './gb.js';
import nz from './nz.js';
import de from './de.js';
import au from './au.js';
import pl from './pl.js';

export const COUNTRIES = [
  { country: gb, page: '', data: 'data', flag: 'flags/gb.svg' },
  { country: nz, page: 'nz/', data: 'data/nz', flag: 'flags/nz.svg' },
  { country: de, page: 'de/', data: 'data/de', flag: 'flags/de.svg' },
  { country: au, page: 'au/', data: 'data/au/nem', flag: 'flags/au.svg' },
  { country: pl, page: 'pl/', data: 'data/pl', flag: 'flags/pl.svg' },
];

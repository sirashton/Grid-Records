// Published figures the market data can't show, and the sources the story
// cites. Every URL here was opened when the story was written.

const ESN = 'Energy-Storage.News';

export const HOME_BATTERIES = {
  latest: { installs: 507000, when: '17 August 2026' },
  milestones: [
    { when: 'July 2025', text: 'the Cheaper Home Batteries Program opens, paying about 30% of the cost of a home battery', url: 'https://www.energy-storage.news/australias-cheaper-home-batteries-program-officially-passes-500000-installations/', source: ESN },
    { when: 'May 2026', text: 'more than 400,000 batteries installed, 11.2 GWh between them', url: 'https://www.energy-storage.news/australia-hits-400000-home-battery-installations-with-11-2gwh-capacity-in-under-a-year/', source: ESN },
    { when: 'August 2026', text: 'more than 507,000 installed, an estimated 14 GWh', url: 'https://www.energy-storage.news/australias-cheaper-home-batteries-program-officially-passes-500000-installations/', source: ESN },
  ],
};

export const AEMO_Q2_2026 = {
  homeBatteryMwh: 11321,
  homeBatteryInstalls: 389137,
  homeBatteryGrowthPct: 41,
  eveningImportCutPct: 73,
  url: 'https://www.aemo.com.au/newsroom/media-release/qed-q2-2026',
  newsUrl: 'https://www.energy-storage.news/nem-battery-price-spreads-fall-85-in-a-year-as-australias-grid-scale-bess-fleet-passes-9000mw/',
};

// East coast wholesale gas, $/GJ, April to June 2026 (AEMO's QED media release).
export const GAS_PRICE_GJ = 9.08;
// Rough fuel cost of an open-cycle gas turbine at 11 GJ per MWh, and of a
// combined-cycle plant at 7.5 GJ per MWh: our estimate, with no carbon price.
export const OCGT_COST = GAS_PRICE_GJ * 11;
export const CCGT_COST = GAS_PRICE_GJ * 7.5;

export const SOURCES = {
  qedQ1_2026: 'https://www.aemo.com.au/-/media/files/major-publications/qed/2026/qed-q1-2026.pdf',
  qedQ2_2026: 'https://www.aemo.com.au/newsroom/media-release/qed-q2-2026',
  qedQ4_2025: 'https://www.aemo.com.au/newsroom/media-release/renewables-supply-more-than-half-of-quarterly-energy-supply',
  mingen: 'https://wattclarity.com.au/articles/2024/02/a-look-into-minimum-generation-levels-at-various-coal-plants-using-the-gsd2023/',
  negativeBids: 'https://wattclarity.com.au/?p=9676',
  eraringDeal: 'https://reneweconomy.com.au/eraring-coal-closure-delayed-two-years-to-keep-the-lights-on/',
  eraringNoClaim: 'https://reneweconomy.com.au/origin-chooses-not-to-tap-taxpayer-funds-for-first-year-of-eraring-coal-plants-extended-operations/',
  eraring2029: 'https://announcements.asx.com.au/asxpdf/20260120/pdf/06vdrfc7bjpbxy.pdf',
  yallourn2021: 'https://reneweconomy.com.au/energyaustralia-says-yallourn-coal-generator-to-close-early-in-2028',
  yallourn2028: 'https://utilitymagazine.com.au/vic-gov-confirms-yallourn-power-station-to-close-in-2028/',
  agl2035: 'https://esdnews.com.au/agl-to-exit-coal-completely-by-2035/',
  qldRoadmap: 'https://esdnews.com.au/queensland-government-extends-coal-plants-in-energy-roadmap/',
  syncons: 'https://www.energymagazine.com.au/sa-synchronous-condensers-to-boost-renewables/',
  saMinimum: 'https://www.aemo.com.au/-/media/files/electricity/nem/security_and_reliability/congestion-information/related-resources/reduction-of-minimum-synchronous-generators-in-south-australia.pdf',
  pec: 'https://www.aer.gov.au/system/files/2026-08/AEMO%20letter%20to%20Clare%20Savage%20AER%20RE%20-%20System%20security%20and%20reliability%20in%20relation%20to%20Project%20EnergyConnect%202026.06.01_0.pdf',
  aemo2025: 'http://www.pv-magazine-australia.com/2021/08/17/aemos-2025-goal-means-that-sa-becomes-the-proving-grounds/',
  cisTarget: 'https://hamiltonlocke.com.au/federal-government-announces-expansion-of-capacity-investment-scheme-aiming-to-secure-32-gw-of-renewable-generation-and-storage-by-2030/',
  cisTender8: 'https://www.energy-storage.news/australia-awards-4-2gw-16-1gwh-of-battery-storage-under-capacity-investment-scheme-tender-8/',
  isp2026: 'https://www.abc.net.au/news/2026-06-25/batteries-boom-wind-stalls-aemo-isp-plan/106837876',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['Q4 2026', 'Project EnergyConnect stage 2, the second South Australia to NSW link, is energised, with full capacity by Q4 2027. AEMO says the minimum number of gas units in South Australia can only fall to zero after it.', 'pec', 'South Australia\'s longest spell with fossil under 100 MW, and its lowest fossil half hour.'],
  ['Q1 2027', 'The Eraring battery reaches 700 MW and 3,160 MWh, about 4.5 hours, in its final stages.', 'eraring2029', 'Most battery output; gas between 4pm and 9pm.'],
  ['Mid-2028', 'Yallourn, about 1,450 MW of brown coal in the Latrobe Valley, closes under a 2021 deal with the Victorian government whose terms were not published.', 'yallourn2028', 'Brown coal falls by a quarter; Victoria\'s lowest fossil half hour and the NEM\'s lowest coal half hour.'],
  ['30 Apr 2029', 'Eraring, 2,880 MW and the NEM\'s biggest station, closes. Origin moved the date from August 2027 in January 2026, citing AEMO\'s system security plan and late transmission and storage.', 'eraring2029', 'The coal floor: its minimum stable load goes with it. Hours with fossil under 8 GW.'],
  ['By 31 Dec 2029', 'The 15 batteries of Capacity Investment Scheme tender 8, 4.2 GW and 16.1 GWh, must be operating.', 'cisTender8', 'Days the batteries could cover the evening ramp; gas between 4pm and 9pm.'],
  ['2030', 'The Capacity Investment Scheme target: 23 GW of new wind and solar and 9 GW of dispatchable capacity underwritten. AEMO\'s 2026 ISP wants 33 GW of batteries by then.', 'isp2026', 'The noon coal dip and the hours below zero; the battery output peak.'],
  ['2030 to 2033', 'Bayswater, AGL\'s black coal station in NSW, closes.', 'agl2035', 'Black coal\'s floor in NSW; hours with fossil under 8 GW.'],
  ['2035', 'Loy Yang A closes and AGL leaves coal. AEMO expects two thirds of the coal fleet to be gone by 2035.', 'agl2035', 'Brown coal to near zero; the longest spell with fossil under 8 GW.'],
  ['Into the 2040s', 'Queensland\'s government-owned coal stations are kept running under the state\'s October 2025 energy roadmap, which dropped the plan to close them by 2035.', 'qldRoadmap', 'The floor that stays: Queensland\'s coal is the last the NEM will burn.'],
];

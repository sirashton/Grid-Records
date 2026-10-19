// Published figures the market data can't show: home batteries sit behind
// the meter. Each figure links to where it was published.

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

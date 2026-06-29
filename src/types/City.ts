// A point-in-time macro snapshot of the whole city for the overview dashboard (task 031). Derived purely from
// `game` getters by City.getCityStats(); the window just renders it. Kept in its own module (no imports) so
// both game/City and the React window can use it without an import cycle.
export interface CityStats {
    name: string;
    population: number; // materialized people on the map
    households: number;
    avgHouseholdSize: number;
    homelessHouseholds: number;
    homelessPeople: number;
    businesses: number;
    vacantWorkBuildings: number;
    byLineOfWork: { line: string; count: number }[];
    employedAdults: number;
    unemployedAdults: number;
    openPositions: number;
    poolSize: number; // total genealogy records
    livingPool: number; // living records in the off-map pool
    householdWealth: number; // aggregate person balances
    businessBalance: number; // aggregate business balances
    stressedBusinesses: number; // businesses in the red
    stressedHouseholds: number; // households in arrears
    births: number; // session tallies since load (not persisted)
    deaths: number;
    bankruptcies: number;
    evictions: number;
}

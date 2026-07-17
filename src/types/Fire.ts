// Building condition & fire (task 102 / proposal H4). Condition is fire's substrate and independently
// useful texture: buildings wear slowly (closed-form — level minus wear over the days since last touch,
// never per-tick mutation), fires damage them in steps, and a destroyed building leaves through the same
// coherent teardown bulldozing uses. Serialized (v16 family).

export interface BuildingConditionRecord {
    level: number; // as of sinceTick
    sinceTick: number;
}

export interface BuildingConditionsState {
    buildings: Record<string, BuildingConditionRecord>; // keyed by anchor key
}

export interface FireConfig {
    wearPerDay: number;
    conditionFloor: number;
    ignitionPerYearAtFullCondition: number; // a kept-up building almost never ignites
    ignitionPerYearAtFloor: number; // a derelict one is a hazard
    responseTicks: number; // how long a fire burns before the outcome resolves
    crewForFullResponse: number; // firefighters ON SCENE at resolution for the full arrival factor (task 110)
    injuryChancePerOccupant: number;
    damage: { extinguished: number; damaged: number };
}

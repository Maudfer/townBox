// Detention (task 100 / proposal G5): a lived, serialized state — not a despawn. The detainee stays
// materialized and inspectable; the detained hook keeps them at the facility running the constrained
// repertoire, and the release sweep frees them when the sentence lapses. Save v16 family.

import { PersonId } from 'types/Genealogy';

export interface DetentionRecord {
    untilTick: number;
    locationKey: string; // the jail's (or, as the stopgap, the police station's) building anchor key
}

export interface DetentionState {
    people: Record<PersonId, DetentionRecord>;
}

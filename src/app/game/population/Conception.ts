import EventEngine from 'game/events/EventEngine';
import { PopulationState, PersonId } from 'types/Genealogy';
import { Genders } from 'types/Social';
import { SeededRandom, hashStringToSeed } from 'util/random';
import { spouseAt } from 'util/kinship';

// Conception rides intimacy (W4 / proposal simulation-aliveness-3 P1-6): `had_sex` used to have zero
// effects while `pregnancy` free-rolled on married couples — causally disconnected, so pregnancies read as
// out of the blue. Now every had_sex commit rolls a seeded conception chance and, on a hit, INVOKES the
// pregnancy event on the would-be mother — the event's own eligibility (alive, married, wantsMoreChildren,
// the age gradient via the manual channel's checks) still gets the last word, so this can never conceive
// where the manifest says no. The probabilistic trigger stays as a demoted background channel (rate 0.15)
// for lives the commit-driven path can't see. Shared by City (live) and LogicalWorld (off-map): one salt,
// one chance, identical on both sides of the boundary.

export const CONCEPTION_SALT = 'conception#';
export const CONCEPTION_CHANCE = 0.10;

export function maybeConceive(
    state: PopulationState, engine: EventEngine, subjectId: PersonId,
    tick: number, ticksPerYear: number, causationId: number | null
): void {
    const subject = state.people[subjectId];
    if (!subject) {
        return;
    }
    // The would-be mother: the female side of the pairing (the had_sex subject may be either partner).
    const motherId = subject.gender === Genders.Female ? subjectId : spouseAt(state.people, subjectId, tick);
    if (!motherId) {
        return;
    }
    const rng = new SeededRandom((state.worldSeed ^ hashStringToSeed(CONCEPTION_SALT + tick + '#' + motherId)) >>> 0);
    if (rng.next() >= CONCEPTION_CHANCE) {
        return;
    }
    engine.invoke(state, 'pregnancy', motherId, tick, ticksPerYear, { source: 'system', causationId });
}

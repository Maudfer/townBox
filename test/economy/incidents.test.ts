import CityIncidents, { INCIDENT_COLD_AFTER_TICKS } from 'game/economy/CityIncidents';

// The city-incidents registry (task 099 / proposal G4): pure bookkeeping — crimes reported with ground-truth
// suspects, wanted = open + witnessed, resolution and cold-case sweeps, and the save round-trip.

describe('the blotter', () => {
    test('reporting, wanted status, and resolution', () => {
        const incidents = new CityIncidents();
        expect(incidents.isWanted('thief')).toBe(false);

        const witnessed = incidents.report('shoplifting', 100, 'building:5-5', 'thief', 2);
        const unseen = incidents.report('pickpocketing', 110, 'building:6-6', 'sneak', 0);
        expect(incidents.open()).toHaveLength(2);
        // Wanted requires WITNESSES — an unseen crime is unknowable to police.
        expect(incidents.isWanted('thief')).toBe(true);
        expect(incidents.isWanted('sneak')).toBe(false);

        incidents.resolve(witnessed.id, 200);
        expect(incidents.isWanted('thief')).toBe(false);
        expect(incidents.open()).toHaveLength(1);
        expect(incidents.all().find(record => record.id === witnessed.id)!.status).toBe('resolved');
        void unseen;
    });

    test('cold cases: the trail expires; a dead suspect closes their file', () => {
        const incidents = new CityIncidents();
        incidents.report('shoplifting', 100, 'building:5-5', 'thief', 2);
        incidents.sweepCold(100 + INCIDENT_COLD_AFTER_TICKS); // exactly at the window — still warm
        expect(incidents.open()).toHaveLength(1);
        incidents.sweepCold(101 + INCIDENT_COLD_AFTER_TICKS);
        expect(incidents.open()).toHaveLength(0);
        expect(incidents.isWanted('thief')).toBe(false);

        const other = new CityIncidents();
        other.report('pickpocketing', 50, 'outside', 'ghost', 3);
        other.removePerson('ghost');
        expect(other.isWanted('ghost')).toBe(false);
        expect(other.open()).toHaveLength(0);
    });

    test('serialize/loadState round-trips deep copies and survives undefined', () => {
        const incidents = new CityIncidents();
        incidents.report('shoplifting', 10, 'building:1-1', 'a', 1);
        const snapshot = incidents.serialize();
        const restored = new CityIncidents();
        restored.loadState(snapshot);
        expect(restored.isWanted('a')).toBe(true);
        restored.report('pickpocketing', 20, 'outside', 'b', 0);
        expect(snapshot.incidents).toHaveLength(1); // deep copy — no leak back
        expect(restored.serialize().nextId).toBe(3);
        restored.loadState(undefined);
        expect(restored.open()).toHaveLength(0);
    });
});

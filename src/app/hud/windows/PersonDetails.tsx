import { FC, useEffect, useState } from 'react';

import Window from 'hud/Window';
import Person from 'game/Person';
import Workplace from 'game/Workplace';

import { formatDay } from 'util/time';
import { DetailsWindowProps } from 'types/HUD';

const INITIAL_SIZE = { width: 360, height: 460 };
const REFRESH_MS = 1500;

// Turns an event id ("had_sex", "get_job") into a readable label until events carry their own labels (032).
function prettifyEventId(id: string): string {
    return id.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function employerName(person: Person): string | null {
    const workplace = person.work.getWorkplace();
    if (workplace instanceof Workplace) {
        return workplace.getBusiness()?.name ?? 'Workplace';
    }
    return null;
}

const PersonDetails: FC<DetailsWindowProps> = ({ game, index, data, onClose }) => {
    const person = data as Person;

    // Re-read the live Person/engine state on a light interval so age and the event log stay current.
    const [, setRefresh] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setRefresh(value => value + 1), REFRESH_MS);
        return () => clearInterval(id);
    }, []);

    if (!person) {
        return null;
    }

    const info = person.social.getInfo();
    const age = person.social.getAge();
    const home = person.social.getHome();
    const job = person.work.getJob();
    const skills = person.work.getSkills();
    const overview = person.getOverview();

    const personId = person.social.getPersonId();
    const history = game.eventEngine?.getHistory() ?? {};
    const events = personId ? history[personId] ?? {} : {};
    const logEntries = Object.entries(events).sort((a, b) => b[1].lastTick - a[1].lastTick);

    const relationshipRows = Object.entries(overview.relationships).filter(([, names]) => !!names);

    return (
        <Window game={game} index={index} title={person.social.getFullName()} initialSize={INITIAL_SIZE} onClose={onClose}>
            <div className="person-details" style={{ padding: '4px 8px', overflowY: 'auto', height: '100%' }}>
                <section>
                    <p><strong>Age:</strong> {age} &nbsp; <strong>Gender:</strong> {info.gender}</p>
                    <p><strong>Home:</strong> {home ? `${home.getHouseholdName()} household` : 'Homeless'}</p>
                </section>

                <section>
                    <h4>Work</h4>
                    {job ? (
                        <p>
                            {job.title}{employerName(person) ? ` @ ${employerName(person)}` : ''} — ${job.salary}
                            <br />
                            <small>Shift {Math.floor(job.shiftStart / 60)}:00–{Math.floor(job.shiftEnd / 60)}:00</small>
                        </p>
                    ) : (
                        <p><em>Unemployed</em></p>
                    )}
                    <p><strong>Skills:</strong> {skills.length ? skills.join(', ') : '—'}</p>
                </section>

                <section>
                    <h4>Relationships</h4>
                    {relationshipRows.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {relationshipRows.map(([relation, names]) => (
                                <li key={relation}><strong>{relation}:</strong> {names}</li>
                            ))}
                        </ul>
                    ) : (
                        <p>—</p>
                    )}
                </section>

                <section>
                    <h4>Life events</h4>
                    {logEntries.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {logEntries.map(([eventId, record]) => (
                                <li key={eventId}>
                                    {prettifyEventId(eventId)} — <small>{formatDay(record.lastTick)}{record.count > 1 ? ` (×${record.count})` : ''}</small>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p><em>No recorded events yet.</em></p>
                    )}
                </section>
            </div>
        </Window>
    );
};

export default PersonDetails;

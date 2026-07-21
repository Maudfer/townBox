import { FC, useEffect, useState } from 'react';

import Person from 'game/agents/Person';
import { sortedSkillEntries } from 'game/skills/SkillBook';
import Workplace from 'game/world/Workplace';
import Window from 'hud/Window';
import { isFollowed, toggleFollow, subscribeFollow } from 'hud/followStore';
import jobsConfig from 'json/jobs.json';
import SKILLS from 'json/skills.json';
import { JobTable } from 'types/Business';

const JOBS = jobsConfig as unknown as JobTable;

// The person's rank label on their job's ladder (task 064/065), or null for rank-less legacy positions.
function rankLabel(job: { title: string; rankId?: string }): string | null {
    if (!job.rankId) {
        return null;
    }
    const definition = Object.values(JOBS).find(candidate => candidate.title === job.title);
    return definition?.ranks.find(rank => rank.rankId === job.rankId)?.label ?? job.rankId;
}
import { DetailsWindowProps } from 'types/HUD';
import { formatTickAtMinute } from 'util/time';
import { resolveLogParams, renderLabelSegments } from 'hud/logEntities';

const INITIAL_SIZE = { width: 800, height: 700 };
const REFRESH_MS = 1500;
const MAX_LOG_ENTRIES = 40;

// Fallback for an event id when the engine isn't available; the engine's getEventLabel prefers the manifest's
// authored label (task 032) and otherwise prettifies the id the same way.
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

// The broad-status word for the "Now:" line (task 081/J1). The active action label carries the specifics.
const STATUS_WORDS: Record<string, string> = {
    idle: 'Idle',
    sleeping: 'Sleeping',
    commuting: 'Commuting',
    working: 'Working',
    performing_action: 'Busy',
    waiting_for_materialization: 'Heading out',
};

// Human hint for an authored action location key ('home', 'outside', 'venue:<kind>').
function locationHint(key: string | undefined): string | null {
    if (!key) {
        return null;
    }
    if (key === 'home') {
        return 'at home';
    }
    if (key === 'outside') {
        return 'outside';
    }
    if (key.startsWith('venue:')) {
        return `at a ${key.slice('venue:'.length).replace(/_/g, ' ')}`;
    }
    return null;
}

const PersonDetails: FC<DetailsWindowProps> = ({ game, index, data, z, onFocus, onClose }) => {
    const person = data as Person;

    // Re-read the live Person/engine state on a light interval so age and the event log stay current.
    const [, setRefresh] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setRefresh(value => value + 1), REFRESH_MS);
        const unsubscribe = subscribeFollow(() => setRefresh(value => value + 1));
        return () => {
            clearInterval(id);
            unsubscribe();
        };
    }, []);

    if (!person) {
        return null;
    }

    const info = person.social.getInfo();
    const age = person.social.getAge();
    const home = person.social.getHome();
    const job = person.work.getJob();
    const overview = person.getOverview();

    const personId = person.social.getPersonId();
    const balance = personId ? game.economy?.getPersonBalance(personId) : undefined;
    // The append-only life log (task 040): every committed occurrence, newest first, capped for rendering.
    const fullLog = personId ? game.eventEngine?.getPersonLog(personId) ?? [] : [];
    const logEntries = fullLog.slice(-MAX_LOG_ENTRIES).reverse();

    // The "Now:" line (task 081/J1): broad status from the Brain + the active instance's authored label.
    const status = personId && game.brain ? game.brain.statusOf(personId) : null;
    const activeInstance = personId ? game.actionEngine?.activeInstanceOf(personId) ?? null : null;
    const activeDef = activeInstance ? game.actionEngine?.getDefinition(activeInstance.defId) : undefined;
    const activeLabel = activeInstance ? game.actionEngine?.getActionLabel(activeInstance.defId) ?? activeInstance.defId : null;
    const whereHint = status?.status === 'working'
        ? (employerName(person) ? `at ${employerName(person)}` : null)
        : locationHint(activeInstance?.locationOverride ?? activeDef?.location);
    const nowLine = status
        ? `${STATUS_WORDS[status.status] ?? status.status}${activeLabel && status.status !== 'sleeping' ? ` — ${activeLabel}` : ''}${whereHint ? ` (${whereHint})` : ''}`
        : null;

    // Needs meters (task 084): the decayed levels, refreshed on the same interval as everything else.
    const worldSeed = game.population?.getState().worldSeed ?? 0;
    const needLevels = personId && game.needs ? game.needs.levelsOf(personId, game.clock?.getCurrentTick() ?? 0, worldSeed) : null;
    const moodLevel = personId && game.mood ? game.mood.moodOf(personId, game.clock?.getCurrentTick() ?? 0) : null;

    // The day strip (task 081/J3): this in-game day's log entries bucketed by hour, midnight → now.
    const currentTick = game.clock?.getCurrentTick() ?? 0;
    const dayStartTick = currentTick - (((currentTick % 24) + 24) % 24);
    const hourBuckets: string[][] = Array.from({ length: 24 }, () => []);
    for (const entry of fullLog) {
        if (entry.tick >= dayStartTick && entry.tick <= currentTick) {
            const hour = entry.tick - dayStartTick;
            const label = entry.kind === 'action'
                ? game.actionEngine?.getActionLabel(entry.defId) ?? entry.defId
                : game.eventEngine?.getEventLabel(entry.defId) ?? entry.defId;
            hourBuckets[hour]?.push(label);
        }
    }
    // Proficiency-bearing skill records (task 059), highest first.
    const skillEntries = personId && game.skillBook ? sortedSkillEntries(game.skillBook.skillsOf(personId)) : [];
    const skillLabel = (skillId: string): string => game.skillBook?.getManifest()[skillId]?.label ?? skillId;
    // Carried Possessions (task 041): top-level items; containers note their contents count.
    const possessions = personId ? game.inventory?.possessionsOf(personId) ?? [] : [];

    const relationshipRows = Object.entries(overview.relationships).filter(([, names]) => !!names);

    return (
        <Window game={game} index={index} z={z} onFocus={onFocus} title={person.social.getFullName()} testId="window-person" initialSize={INITIAL_SIZE} onClose={onClose}>
            <div className="person-details" style={{ padding: '4px 8px', overflowY: 'auto', height: '100%' }}>
                <section>
                    {nowLine && (
                        <p data-testid="person-now-line">
                            <strong>Now:</strong> {nowLine}
                            {personId && (
                                <button
                                    data-testid="follow-toggle"
                                    style={{ marginLeft: 8, fontSize: 11, cursor: 'pointer' }}
                                    onClick={() => toggleFollow(personId, person.social.getFullName())}
                                >
                                    {isFollowed(personId) ? '★ Following' : '☆ Follow'}
                                </button>
                            )}
                        </p>
                    )}
                    <p><strong>Age:</strong> {age} &nbsp; <strong>Gender:</strong> {info.gender}</p>
                    {personId && game.traits && game.traits.describe(personId) && (
                        <p data-testid="person-temperament"><em>{game.traits.describe(personId)}</em></p>
                    )}
                    <p><strong>Home:</strong> {home ? `${home.getHouseholdName()} household` : 'Homeless'}</p>
                    {balance !== undefined && <p><strong>Balance:</strong> ${balance.toLocaleString()}</p>}
                </section>

                {needLevels && (
                    <section>
                        <h4>Needs{moodLevel !== null ? ` · Mood ${moodLevel.toFixed(0)}` : ""}</h4>
                        <div data-testid="person-needs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                            {Object.entries(needLevels).map(([need, level]) => (
                                <div key={need} title={`${need}: ${level.toFixed(0)}/100`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <small style={{ width: 52, textTransform: 'capitalize' }}>{need}</small>
                                    <div style={{ flex: 1, height: 6, background: 'rgba(127,127,127,0.25)', borderRadius: 3 }}>
                                        <div style={{
                                            width: `${Math.max(0, Math.min(100, level))}%`, height: '100%', borderRadius: 3,
                                            background: level <= 20 ? '#d9534f' : level <= 50 ? '#e6a23c' : '#7fb069',
                                        }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section>
                    <h4>Today</h4>
                    <div data-testid="person-day-strip" style={{ display: 'flex', gap: 1 }}>
                        {hourBuckets.map((labels, hour) => {
                            const future = dayStartTick + hour > currentTick;
                            const background = future ? 'transparent' : labels.length > 0 ? '#7fb069' : 'rgba(127,127,127,0.25)';
                            return (
                                <div
                                    key={hour}
                                    title={`${hour}:00${labels.length ? ` — ${labels.join(', ')}` : ''}`}
                                    style={{
                                        flex: 1, height: 10, background,
                                        border: '1px solid rgba(127,127,127,0.35)', borderRadius: 2,
                                    }}
                                />
                            );
                        })}
                    </div>
                    <small style={{ opacity: 0.7 }}>0:00 → 23:00 · green = logged activity that hour (hover for details)</small>
                </section>

                <section>
                    <h4>Work</h4>
                    {job ? (
                        <p>
                            {job.title}{rankLabel(job) ? ` (${rankLabel(job)})` : ''}{employerName(person) ? ` @ ${employerName(person)}` : ''} — ${job.salary}
                            <br />
                            <small>Shift {Math.floor(job.shiftStart / 60)}:00–{Math.floor(job.shiftEnd / 60)}:00</small>
                        </p>
                    ) : (
                        <p><em>Unemployed</em></p>
                    )}
                    {skillEntries.length ? (() => {
                        // Grouped skills (LP-10): the flat list was a wall of ~70 rows. Top abilities stay
                        // visible; the long tail and the (mostly-60.0) school basics collapse.
                        const basics = skillEntries.filter(([skillId]) => (SKILLS as Record<string, { basic?: boolean }>)[skillId]?.basic === true);
                        const abilities = skillEntries.filter(([skillId]) => (SKILLS as Record<string, { basic?: boolean }>)[skillId]?.basic !== true);
                        const TOP = 8;
                        const row = ([skillId, record]: typeof skillEntries[number]): JSX.Element => (
                            <li key={skillId} title={`since ${record.firstAcquiredTick}; ${record.provenance.join(', ')}`}>
                                {skillLabel(skillId)} — {record.proficiency.toFixed(1)}
                            </li>
                        );
                        return (
                            <>
                                <ul style={{ margin: 0, paddingLeft: 16 }}>{abilities.slice(0, TOP).map(row)}</ul>
                                {abilities.length > TOP && (
                                    <details style={{ marginLeft: 16 }}>
                                        <summary>{abilities.length - TOP} more abilities</summary>
                                        <ul style={{ margin: 0, paddingLeft: 16 }}>{abilities.slice(TOP).map(row)}</ul>
                                    </details>
                                )}
                                {basics.length > 0 && (
                                    <details style={{ marginLeft: 16 }}>
                                        <summary>School basics ({basics.length})</summary>
                                        <ul style={{ margin: 0, paddingLeft: 16 }}>{basics.map(row)}</ul>
                                    </details>
                                )}
                            </>
                        );
                    })() : (
                        <p><strong>Skills:</strong> —</p>
                    )}
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
                    <h4>Possessions</h4>
                    {possessions.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {possessions.map(instance => {
                                const archetype = game.inventory?.getArchetype(instance.archetypeId);
                                const contained = game.inventory?.contentsOf({ kind: 'object', instanceId: instance.id }) ?? [];
                                return (
                                    <li key={instance.id}>
                                        {archetype?.label ?? instance.archetypeId}{instance.quantity > 1 ? ` ×${instance.quantity}` : ''}
                                        {contained.length > 0 && <small> (contains {contained.length})</small>}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p>—</p>
                    )}
                </section>

                <section>
                    <h4>Life events</h4>
                    {logEntries.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {logEntries.map(entry => {
                                // Failed actions carry a typed reason (task 073) — render it, humanized.
                                const failureSuffix = entry.kind === 'action' && entry.failureReason ? `: ${entry.failureReason.replace(/_/g, ' ')}` : '';
                                const label = entry.kind === 'action'
                                    ? `${game.actionEngine?.getActionLabel(entry.defId) ?? prettifyEventId(entry.defId)}${entry.lifecycle !== 'performed' ? ` (${entry.lifecycle}${failureSuffix})` : ''}`
                                    : game.eventEngine?.getEventLabel(entry.defId) ?? prettifyEventId(entry.defId);
                                // Entity-linked, templated labels (LP-14 / M5): "Hugged Ana Souza" rendered inline
                                // from the label's {placeholders}; unreferenced params still append as chips, and
                                // person references stay clickable either way.
                                const resolved = entry.params ? resolveLogParams(game, entry.params) : [];
                                const { segments, leftovers } = renderLabelSegments(label, resolved);
                                const chip = (key: string, param: NonNullable<ReturnType<typeof resolveLogParams>[number]>, inline: boolean): JSX.Element =>
                                    param.person
                                        ? <button key={key} type="button" onClick={() => game.emit('PersonSelected', param.person!)}
                                            style={{ marginLeft: inline ? 0 : 4, cursor: 'pointer', background: 'none', border: 'none', padding: 0, color: '#7fd0ff', textDecoration: 'underline', font: 'inherit' }}>
                                            {param.text}
                                        </button>
                                        : <span key={key} style={{ marginLeft: inline ? 0 : 4, opacity: inline ? 1 : 0.85 }}>{inline ? param.text : `[${param.text}]`}</span>;
                                return (
                                    <li key={entry.seq}>
                                        {segments.map((segment, index) => segment.param
                                            ? chip(`s${index}`, segment.param, true)
                                            : <span key={`s${index}`}>{segment.text}</span>)}
                                        {leftovers.map(param => chip(param.key, param, false))}
                                        {' — '}<small>{formatTickAtMinute(entry.tick, entry.minute)}{entry.triggerSource !== 'probability' ? ` · ${entry.triggerSource}` : ''}</small>
                                    </li>
                                );
                            })}
                            {fullLog.length > MAX_LOG_ENTRIES && <li><em>… {fullLog.length - MAX_LOG_ENTRIES} earlier entries</em></li>}
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

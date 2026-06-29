import { FC, useEffect, useState } from 'react';

import Window from 'hud/Window';
import Workplace from 'game/Workplace';

import { summarizePositions } from 'util/positions';
import { DetailsWindowProps } from 'types/HUD';

const INITIAL_SIZE = { width: 360, height: 440 };
const REFRESH_MS = 1500;

const WorkplaceDetails: FC<DetailsWindowProps> = ({ game, index, data, onClose }) => {
    const workplace = data as Workplace;

    const [, setRefresh] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setRefresh(value => value + 1), REFRESH_MS);
        return () => clearInterval(id);
    }, []);

    if (!workplace) {
        return null;
    }

    const business = workplace.getBusiness();
    const employees = workplace.getEmployees();

    if (!business) {
        return (
            <Window game={game} index={index} title="Vacant work building" initialSize={INITIAL_SIZE} onClose={onClose}>
                <div style={{ padding: '8px' }}><em>No business operates here.</em></div>
            </Window>
        );
    }

    const positions = summarizePositions(business.positions, workplace.getOpenPositions());
    const balance = game.economy?.getBusinessBalance(workplace.getIdentifier());

    return (
        <Window game={game} index={index} title={business.name} initialSize={INITIAL_SIZE} onClose={onClose}>
            <div style={{ padding: '4px 8px', overflowY: 'auto', height: '100%' }}>
                <p><strong>{business.lineOfWork}</strong> &nbsp; <small>size {business.size}</small></p>
                {balance !== undefined && <p><strong>Balance:</strong> ${balance.toLocaleString()}</p>}
                {business.lastPnl !== undefined && (
                    <p>
                        <strong>Last P&amp;L:</strong>{' '}
                        <span style={{ color: business.lastPnl >= 0 ? '#7CFC8A' : '#FF7A7A' }}>
                            {business.lastPnl >= 0 ? '+' : '−'}${Math.abs(Math.round(business.lastPnl)).toLocaleString()}/mo
                        </span>
                    </p>
                )}

                <section>
                    <h4>Positions</h4>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {positions.map(position => (
                            <li key={position.title}>
                                {position.title}: <strong>{position.filled}/{position.total}</strong> filled
                                {position.open > 0 ? <small> ({position.open} open)</small> : null}
                            </li>
                        ))}
                    </ul>
                </section>

                <section>
                    <h4>Employees ({employees.length})</h4>
                    {employees.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {employees.map((employee, employeeIndex) => (
                                <li
                                    key={employeeIndex}
                                    style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                    onClick={() => game.emit('PersonSelected', employee)}
                                >
                                    {employee.social.getFullName()} — <small>{employee.work.getJob()?.title ?? '—'}</small>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p><em>No employees yet.</em></p>
                    )}
                </section>
            </div>
        </Window>
    );
};

export default WorkplaceDetails;

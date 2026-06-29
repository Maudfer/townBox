import { FC, useEffect, useState } from 'react';

import Window from 'hud/Window';
import City from 'game/City';

import { DetailsWindowProps } from 'types/HUD';
import { CityStats } from 'types/City';

const INITIAL_SIZE = { width: 340, height: 480 };
const REFRESH_MS = 2000;

// City overview / dashboard (task 031): a read-only macro snapshot complementing the per-entity inspectors.
// All figures come from City.getCityStats() (derived from game getters). Refreshed on a light interval rather
// than the `newDay` bus event, because the bus's off() drops *all* handlers for an event and City owns the
// newDay handler — recomputing every couple of seconds is plenty fresh for a dashboard and never per-frame.
const CityDetails: FC<DetailsWindowProps> = ({ game, index, data, onClose }) => {
    const city = data as City;
    const [stats, setStats] = useState<CityStats | null>(() => city?.getCityStats() ?? null);

    useEffect(() => {
        const id = setInterval(() => setStats(city?.getCityStats() ?? null), REFRESH_MS);
        return () => clearInterval(id);
    }, []);

    if (!city || !stats) {
        return null;
    }

    const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

    return (
        <Window game={game} index={index} title={`${stats.name} — overview`} initialSize={INITIAL_SIZE} onClose={onClose}>
            <div style={{ padding: '4px 10px', overflowY: 'auto', height: '100%' }}>
                <section>
                    <h4>Population</h4>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>Residents on the map: <strong>{stats.population}</strong></li>
                        <li>Households: <strong>{stats.households}</strong> (avg {stats.avgHouseholdSize.toFixed(1)} people)</li>
                        <li>Homeless: <strong>{stats.homelessPeople}</strong> in {stats.homelessHouseholds} household(s)</li>
                        <li>Genealogy pool: <strong>{stats.livingPool.toLocaleString()}</strong> living / {stats.poolSize.toLocaleString()} total</li>
                    </ul>
                </section>

                <section>
                    <h4>Employment</h4>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>Employed adults: <strong>{stats.employedAdults}</strong></li>
                        <li>Unemployed adults: <strong>{stats.unemployedAdults}</strong></li>
                        <li>Open positions: <strong>{stats.openPositions}</strong></li>
                    </ul>
                </section>

                <section>
                    <h4>Businesses ({stats.businesses})</h4>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>Vacant work buildings: <strong>{stats.vacantWorkBuildings}</strong></li>
                        <li>In the red: <strong>{stats.stressedBusinesses}</strong></li>
                        {stats.byLineOfWork.length > 0 && (
                            <li>By line of work:
                                <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {stats.byLineOfWork.map(entry => (
                                        <li key={entry.line}>{entry.line}: <strong>{entry.count}</strong></li>
                                    ))}
                                </ul>
                            </li>
                        )}
                    </ul>
                </section>

                <section>
                    <h4>Economy</h4>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>Aggregate household wealth: <strong>{money(stats.householdWealth)}</strong></li>
                        <li>Aggregate business balance: <strong>{money(stats.businessBalance)}</strong></li>
                        <li>Households in arrears: <strong>{stats.stressedHouseholds}</strong></li>
                    </ul>
                </section>

                <section>
                    <h4>Since this session</h4>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                        <li>Births: <strong>{stats.births}</strong> &nbsp; Deaths: <strong>{stats.deaths}</strong></li>
                        <li>Bankruptcies: <strong>{stats.bankruptcies}</strong> &nbsp; Evictions: <strong>{stats.evictions}</strong></li>
                    </ul>
                </section>
            </div>
        </Window>
    );
};

export default CityDetails;

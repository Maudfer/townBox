import { renderLabelSegments, ResolvedParam } from 'hud/logEntities';

// Label templating (LP-14 layer 3): "Hugged {target}" renders the resolved name inline (clickable when
// materialized — the chip part is the browser suite's business); unreferenced params return as leftovers
// so untemplated labels degrade to the pre-template chip rendering.

function param(key: string, text: string): ResolvedParam {
    return { key, text };
}

describe('renderLabelSegments (LP-14)', () => {
    test('substitutes placeholders inline and keeps their param attached', () => {
        const { segments, leftovers } = renderLabelSegments('Hugged {target}', [param('target', 'Ana Souza')]);
        expect(segments.map(segment => segment.text)).toEqual(['Hugged ', 'Ana Souza']);
        expect(segments[1]!.param?.key).toBe('target');
        expect(leftovers).toEqual([]);
    });

    test('multi-placeholder labels interleave text and params in order', () => {
        const { segments } = renderLabelSegments('Returned {object} to {target}', [param('target', 'Bruno'), param('object', 'a toolbox')]);
        expect(segments.map(segment => segment.text)).toEqual(['Returned ', 'a toolbox', ' to ', 'Bruno']);
    });

    test('an untemplated label leaves every param as a leftover chip', () => {
        const { segments, leftovers } = renderLabelSegments('Grabbed an object', [param('object', 'a pebble')]);
        expect(segments.map(segment => segment.text)).toEqual(['Grabbed an object']);
        expect(leftovers.map(left => left.key)).toEqual(['object']);
    });

    test('an unresolvable placeholder degrades readably instead of showing braces', () => {
        const { segments } = renderLabelSegments('Applied at {employer}', []);
        expect(segments.map(segment => segment.text)).toEqual(['Applied at ', 'employer']);
    });
});
